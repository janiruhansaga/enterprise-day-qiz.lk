import { z } from 'zod';
import { UserRole } from '../config/security.js';

export const RegisterSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }).max(255).transform(v => v.trim().toLowerCase()),
  password: z.string()
    .min(8, { message: 'Password must be at least 8 characters long' })
    .max(128, { message: 'Password must not exceed 128 characters' })
    .regex(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
    .regex(/[a-z]/, { message: 'Password must contain at least one lowercase letter' })
    .regex(/[0-9]/, { message: 'Password must contain at least one number' }),
  displayName: z.string()
    .min(2, { message: 'Display name must be at least 2 characters' })
    .max(50, { message: 'Display name must not exceed 50 characters' })
    .regex(/^[a-zA-Z0-9 _.-]+$/, { message: 'Display name can only contain letters, numbers, spaces, dots, hyphens, and underscores' })
    .transform(v => v.trim()),
  requestedRole: z.nativeEnum(UserRole).optional().default(UserRole.STUDENT),
  invitationCode: z.string().optional().transform(v => v ? v.trim() : v)
});

export const LoginSchema = z.object({
  email: z.string().email().transform(v => v.trim().toLowerCase()),
  password: z.string().min(1).max(128)
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
