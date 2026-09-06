import { Client } from "moon-discord";

type IsAny<T> = 0 extends 1 & T ? true : false;
type ExecuteResult = Awaited<ReturnType<Client["rest"]["execute"]>>;
type ExecuteOptions = Parameters<Client["rest"]["execute"]>[0];

const _executeReturnsUnknown: IsAny<ExecuteResult> extends true ? never : true = true;
const _filesIsSibling: Pick<ExecuteOptions, "files"> = {
  files: [{ filename: "a.txt", bytes: new Uint8Array() }],
};
