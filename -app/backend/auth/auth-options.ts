import { type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { dataStore } from '@/backend/database/data-store';
import { SchemaUpgradeRequired } from '../database/business-db';
import { ownerSessionStamp, validOwnerSession } from './owner-session';

const loginSchema = z.object({
  email: z.string().trim().max(254).email(),
  password: z.string().min(6).refine(value => Buffer.byteLength(value) <= 72, 'Password is too long.'),
});

const digest = (password: string) => createHash('sha256').update(password).digest();

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          const { email, password } = await loginSchema.parseAsync(credentials);

          let user = dataStore.getUserByEmail(email);
          const ownerEmail = process.env.BIZFLOW_OWNER_EMAIL;
          const initialPassword = process.env.BIZFLOW_OWNER_PASSWORD;
          if (!user && ownerEmail && email.toLowerCase() === ownerEmail.toLowerCase() &&
              initialPassword && initialPassword.length >= 12 && Buffer.byteLength(initialPassword) <= 72 &&
              timingSafeEqual(digest(password), digest(initialPassword))) {
            dataStore.provisionOwner(process.env.BIZFLOW_OWNER_NAME || 'Owner', ownerEmail, initialPassword);
            user = dataStore.getUserByEmail(email);
          }

          if (user?.role !== 'admin' || !bcrypt.compareSync(password, user.password_hash)) {
            return null;
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            stamp: ownerSessionStamp(user),
          };
        } catch (error) {
          if (error instanceof SchemaUpgradeRequired) throw new Error('SchemaUpgradeRequired');
          if (!(error instanceof z.ZodError)) {
            console.error(JSON.stringify({ event: 'auth.credentials_check_failed', time: new Date().toISOString() }));
          }
          return null;
        }
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.stamp = (user as { stamp?: string }).stamp;
      } else {
        const current = typeof token.id === 'string' ? dataStore.getUserById(token.id) : undefined;
        if (!validOwnerSession(current, token.stamp)) throw new Error('Session expired.');
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; role?: unknown }).id = token.id as string;
        (session.user as { id?: string; role?: unknown }).role = token.role;
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60,
  },
  secret: process.env.NEXTAUTH_SECRET,
  logger: {
    error(code) {
      if (code !== 'JWT_SESSION_ERROR') console.error(JSON.stringify({ event: 'auth.error', code }));
    },
  },
};
