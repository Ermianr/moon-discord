const SNOWFLAKE_SHIFT_DIVISOR = 4_194_304;

export function guildShardId(guildId: string, numShards: number): number {
  let remainder = 0;
  let quotMod = 0;
  for (let index = 0; index < guildId.length; index += 1) {
    const digit = guildId.charCodeAt(index) - 48;
    remainder = remainder * 10 + digit;
    const digitQuot = Math.floor(remainder / SNOWFLAKE_SHIFT_DIVISOR);
    remainder = remainder - digitQuot * SNOWFLAKE_SHIFT_DIVISOR;
    quotMod = (quotMod * 10 + digitQuot) % numShards;
  }
  return quotMod;
}

export function processOwnsGuild(guildId: string, shardCount: number, ownedShardId: number): boolean {
  return guildShardId(guildId, shardCount) === ownedShardId;
}
