import { z } from 'zod';

export const CreateGameSessionSchema = z.object({
  quizId: z.string().uuid({ message: 'Invalid quiz ID format' })
});

export const JoinGameSchema = z.object({
  pin: z.string().length(6, { message: 'PIN must be exactly 6 digits' }).regex(/^\d{6}$/, { message: 'PIN must be numeric' }),
  nickname: z.string()
    .min(2, { message: 'Nickname must be at least 2 characters' })
    .max(25, { message: 'Nickname cannot exceed 25 characters' })
    .regex(/^[a-zA-Z0-9 _-]+$/, { message: 'Nickname contains invalid characters' })
    .transform(v => v.trim())
});

export const KickParticipantSchema = z.object({
  sessionId: z.string().uuid(),
  participantId: z.string().uuid()
});

export type CreateGameSessionInput = z.infer<typeof CreateGameSessionSchema>;
export type JoinGameInput = z.infer<typeof JoinGameSchema>;
