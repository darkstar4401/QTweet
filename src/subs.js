import {
  getUserIds as SQL_getUserIds,
  getUserSubs as SQL_getUserSubs,
  getUniqueChannels as SQL_getUniqueChannels,
  getGuildSubs as SQL_getGuildSubs,
  getChannelSubs as SQL_getChannelSubs,
  rmChannel as SQL_rmChannel,
  getSubscription as SQL_getSub,
  getUserFromScreenName as SQL_getUserFromScreenName,
  rmUser as SQL_rmUser,
  addSubscription,
  removeSubscription,
  hasUser,
  getUserInfo as SQL_getUserInfo,
  hasChannel,
  addChannel,
  getAllSubs,
  addUser as SQL_addUser,
  open as openDb,
  close as closeDb,
  getGuildChannels
} from "./sqlite";
import log from "./log";
import QChannel from "./QChannel";

export const init = openDb;

export const close = closeDb;

export const getUserIds = SQL_getUserIds;

export const getSub = SQL_getSub;

export const getUserSubs = SQL_getUserSubs;

// Returns a list of channel objects, each in an unique guild
// DMs are also returned, as DMs are considered one-channel guilds
export const getUniqueChannels = SQL_getUniqueChannels;

// Returns a list of subscriptions matching this guild
export const getGuildSubs = SQL_getGuildSubs;

// Returns a list of subscriptions matching this channel
export const getChannelSubs = SQL_getChannelSubs;

export const getUserFromScreenName = SQL_getUserFromScreenName;

export const addUser = SQL_addUser;

export const addUserIfNoExists = async (twitterId, name) => {
  const shouldAddUser = !(await hasUser(twitterId));
  if (shouldAddUser) {
    const users = await addUser(twitterId, name);
    return users;
  }
  return 0;
};

// Makes sure everything is consistent
export const sanityCheck = async () => {
  const allSubscriptions = await getAllSubs();
  log(`Starting sanity check on ${allSubscriptions.length} subscriptions`);
  for (let i = 0; i < allSubscriptions.length; i++) {
    const sub = allSubscriptions[i];
    const qc = QChannel.unserialize(sub);
    const obj = await qc.obj();
    if (!obj) {
      const { subs, users } = await rmChannel(qc.id);
      log(
        `Found invalid qChannel: ${qc.id} (${
          qc.isDM
        }). Deleted ${subs} subs, ${users} users.`
      );
      continue;
    }
    const c = await addChannelIfNoExists(sub.channelId, sub.isDM);
    if (c > 0) {
      log(`Channel wasn't in channels table: ${sub.channelId}`);
    }
    const u = await addUserIfNoExists(sub.twitterId, "temp");
    if (u > 0) {
      log(`User ${sub.twitterId} wasn't in users table.`);
    }
  }
  log(`Sanity check completed.`);
};

export const getUserInfo = SQL_getUserInfo;

export const updateUser = async user => {
  const usrInfo = await getUserInfo(user.id_str);
  if (!usrInfo || usrInfo.name !== user.screen_name) {
    addUser(user.id_str, user.screen_name);
  }
};

export const addChannelIfNoExists = async (channelId, isDM) => {
  const shouldCreateChannel = !(await hasChannel(channelId));
  if (shouldCreateChannel) {
    const qc = QChannel.unserialize({ channelId, isDM });
    const obj = await qc.obj();
    if (!obj) {
      log(
        `Somehow got a bad qChannel on a new subscription: ${channelId}, ${isDM}`
      );
      return 0;
    }
    if (qc.isDM) {
      await addChannel(channelId, channelId, channelId, qc.isDM);
    } else {
      await addChannel(
        channelId,
        await qc.guildId(),
        await qc.ownerId(),
        qc.isDM
      );
    }
    return 1;
  }
  return 0;
};

// Add a subscription to this userId or update an existing one
export const add = async (channelId, twitterId, name, flags, isDM) => {
  const subs = await addSubscription(channelId, twitterId, flags, isDM);
  // If we didn't update any subs we don't have to check for new users
  const users = subs === 0 ? 0 : await addUserIfNoExists(twitterId, name);
  const channels = subs === 0 ? 0 : await addChannelIfNoExists(channelId, isDM);
  return { subs, users, channels };
};

export const rmUser = SQL_rmUser;

const deleteUserIfEmpty = async twitterId => {
  const subs = await getUserSubs(twitterId);
  if (subs.length === 0) {
    await rmUser(twitterId);
    return 1;
  }
  return 0;
};

const deleteChannelIfEmpty = async channelId => {
  const subs = await getChannelSubs(channelId);
  if (subs.length === 0) {
    await rmChannel(channelId);
    return 1;
  }
  return 0;
};

// Remove a subscription
// If this user doesn't have any more subs, delete it as well
export const rm = async (channelId, twitterId) => {
  const subs = await removeSubscription(channelId, twitterId);
  const users = subs === 0 ? 0 : await deleteUserIfEmpty(twitterId);
  const channels = subs === 0 ? 0 : await deleteChannelIfEmpty(channelId);
  return { subs, users, channels };
};

export const rmChannel = async channelId => {
  const subArray = await getChannelSubs(channelId);
  let deletedSubs = 0;
  let deletedUsrs = 0;
  for (let i = 0; i < subArray.length; i++) {
    const { twitterId } = subArray[i];
    const { subs, users } = await rm(channelId, twitterId);
    deletedSubs += subs;
    deletedUsrs += users;
  }
  SQL_rmChannel(channelId);
  return { subs: deletedSubs, users: deletedUsrs };
};

export const rmGuild = async guildId => {
  const channels = await getGuildChannels(guildId);
  let deletedSubs = 0;
  let deletedUsrs = 0;
  for (let i = 0; i < channels.length; i++) {
    const { channelId } = channels[i];
    const { subs, users } = await rmChannel(channelId);
    deletedSubs += subs;
    deletedUsrs += users;
  }
  return { subs: deletedSubs, users: deletedUsrs, channels: channels.length };
};
