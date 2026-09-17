import { z } from 'zod';

export const SubmitAnswerSchema = z.object({
  sessionId: z.string().uuid({ message: 'Invalid session ID format' }),
  questionId: z.string().uuid({ message: 'Invalid question ID format' }),
  selectedOptionId: z.string().uuid({ message: 'Invalid option ID format' }),
  roundNonce: z.string().min(10, { message: 'Round nonce is required' })
});

export type SubmitAnswerInput = z.infer<typeof SubmitAnswerSchema>;
