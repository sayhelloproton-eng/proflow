#!/usr/bin/env -S node --experimental-strip-types

import { runRepositoryArchitecture } from "./architecture.ts";

const result = await runRepositoryArchitecture(process.cwd());
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status === "FAIL") process.exitCode = 1;
