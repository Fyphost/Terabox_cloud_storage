import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

const ROUNDS = 12;

export function validatePasswordPolicy(password: string): void {
  if (password.length < env.PASSWORD_MIN_LENGTH) {
    throw new AppError(
      'BAD_REQUEST',
      `Password must be at least ${env.PASSWORD_MIN_LENGTH} characters`,
    );
  }
  if (password.length > 256) {
    throw new AppError('BAD_REQUEST', 'Password too long');
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new AppError('BAD_REQUEST', 'Password must contain both letters and numbers');
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
