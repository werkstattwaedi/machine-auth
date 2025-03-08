declare module "particle-api-js" {
  /** Particle Cloud API wrapper. */
  export default class Particle {
    constructor(options?: {
      baseUrl?: string;
      clientSecret?: string;
      clientId?: string;
      tokenDuration?: number;
      auth?: string;
    });

    callFunction(args: {
      deviceId: string;
      name: string;
      argument: string;
      product?: string;
      auth: string;
      headers?: object;
      context?: object;
    }): Promise<{ return_value: number }>;
  }
}
