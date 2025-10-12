declare module "particle-api-js" {
  interface ParticleDevice {
    id: string;
    name: string;
    online: boolean;
    last_heard: string;
    platform_id: number;
    product_id: number;
    variables?: Record<string, string>;
    functions?: string[];
  }

  interface ParticleResponse<T> {
    body: T;
    statusCode: number;
  }

  interface ListDevicesResponse {
    devices: ParticleDevice[];
    customers?: Array<{ id: string; username: string }>;
    meta?: { total_pages: number };
  }

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

    listDevices(args: {
      product?: string;
      auth: string;
    }): Promise<ParticleResponse<ListDevicesResponse>>;

    getDevice(args: {
      deviceId: string;
      product?: string;
      auth: string;
    }): Promise<ParticleResponse<ParticleDevice>>;

    setLedgerInstance(args: {
      product: string;
      ledgerName: string;
      scopeValue: string;
      instance: { data: Record<string, any> };
      auth: string;
    }): Promise<ParticleResponse<any>>;
  }
}
