# moon-discord

A Discord bot library whose representative programs compile on scriptc's static tier.

## Language

**Client**:
The small public module an application constructs to talk to Discord.
_Avoid_: bot object, discord.js Client, SDK

**Snowflake**:
A Discord entity identifier carried as a decimal string in JSON.
_Avoid_: number, bigint, numeric ID

**Static tier**:
scriptc compilation that produces an engine-free binary without `--dynamic`, including LLVM and native C fallback.
_Avoid_: dynamic, island, treating C fallback as `--dynamic`

**Decode**:
Turning Discord JSON that entered as `unknown` into library-owned structures.
_Avoid_: parse (as in flowing JSON.parse into an exact scriptc record)

**Bucket**:
A Discord rate-limit class identified by response headers, not by a hard-coded route table.
_Avoid_: quota, throttle (as the named limit object)
