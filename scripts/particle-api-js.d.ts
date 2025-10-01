/**
 * Type definitions for particle-api-js
 * Since the library doesn't include TypeScript definitions,
 * we add minimal types for the methods we use.
 */

declare module 'particle-api-js' {
  export default class Particle {
    constructor();
    
    setLedgerInstance(options: {
      product: string;
      ledgerName: string;
      scopeValue: string;
      instance: any;
      auth: string;
    }): Promise<{
      body: any;
      statusCode: number;
    }>;
    
    getLedgerInstance(options: {
      product: string;
      ledgerName: string;
      scopeValue: string;
      auth: string;
    }): Promise<{
      body: any;
      statusCode: number;
    }>;
  }
}
