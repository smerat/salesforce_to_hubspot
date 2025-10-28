import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Environment variable schema validation
const envSchema = z.object({
  // Supabase
  SUPABASE_DB_URL: z.string().url(),

  // Salesforce
  SF_LOGIN_URL: z.string().url(),
  SF_USERNAME: z.string().email(),
  SF_PASSWORD: z.string().min(1),
  SF_SECURITY_TOKEN: z.string().min(1),

  // HubSpot
  HUBSPOT_ACCESS_TOKEN: z.string().min(1),

  // Optional configuration
  BATCH_SIZE: z.string().default('100'),
  MAX_RETRIES: z.string().default('3'),
  RATE_LIMIT_DELAY_MS: z.string().default('100'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

// Validate environment variables
const envValidation = envSchema.safeParse(process.env);

if (!envValidation.success) {
  console.error('❌ Environment variable validation failed:');
  console.error(envValidation.error.format());
  process.exit(1);
}

const env = envValidation.data;

// Export configuration
export const config = {
  supabase: {
    dbUrl: env.SUPABASE_DB_URL,
  },
  salesforce: {
    loginUrl: env.SF_LOGIN_URL,
    username: env.SF_USERNAME,
    password: env.SF_PASSWORD,
    securityToken: env.SF_SECURITY_TOKEN,
  },
  hubspot: {
    accessToken: env.HUBSPOT_ACCESS_TOKEN,
  },
  migration: {
    batchSize: parseInt(env.BATCH_SIZE, 10),
    maxRetries: parseInt(env.MAX_RETRIES, 10),
    rateLimitDelayMs: parseInt(env.RATE_LIMIT_DELAY_MS, 10),
  },
  logging: {
    level: env.LOG_LEVEL,
  },
} as const;

export default config;
