export type IsolatedEnvironment = {
  runDir: string;
  databasePath: string;
  stack: 'dev' | 'full-stack';
  baseUrl: string;
  frontendPort: number;
  apiPort: number;
  seed: string;
};

export function validateIsolatedEnvironment(
  env?: NodeJS.ProcessEnv | Record<string, string>,
  systemTempRoot?: string
): IsolatedEnvironment;
