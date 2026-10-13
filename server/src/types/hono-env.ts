export type AppEnv = {
  Variables: {
    userId: string;
    userEmail?: string;
    appLanguage: 'es' | 'en';
    /** Set only by createApp; internal auth gate, never derived from request input. */
    householdSetupGate?: true;
  };
};
