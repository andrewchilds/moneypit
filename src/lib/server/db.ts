import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForPrisma = globalThis as unknown as { db: PrismaClient };

function createPrismaClient() {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	const adapter = new PrismaPg(pool);
	return new PrismaClient({ adapter });
}

export const db = globalForPrisma.db || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
	globalForPrisma.db = db;
}

export * from '@prisma/client';
