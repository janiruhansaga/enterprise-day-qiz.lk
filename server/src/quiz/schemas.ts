import { z } from 'zod';

export const CreateQuizSchema = z.object({
  title: z.string()
    .min(3, { message: 'Title must be at least 3 characters' })
    .max(120, { message: 'Title must not exceed 120 characters' })
    .transform(v => v.trim()),
  description: z.string().max(500).optional().default('').transform(v => v.trim()),
  isPublished: z.boolean().optional().default(false)
});

export const UpdateQuizSchema = z.object({
  title: z.string().min(3).max(120).optional().transform(v => v ? v.trim() : undefined),
  description: z.string().max(500).optional().transform(v => v ? v.trim() : undefined),
  isPublished: z.boolean().optional()
});

export const OptionSchema = z.object({
  optionText: z.string().min(1, { message: 'Option text cannot be empty' }).max(250).transform(v => v.trim()),
  isCorrect: z.boolean()
});

export const CreateQuestionSchema = z.object({
  prompt: z.string().min(5, { message: 'Prompt must be at least 5 characters' }).max(500).transform(v => v.trim()),
  timeLimitSec: z.number().int().min(5).max(120).optional().default(20),
  basePoints: z.number().int().min(100).max(2000).optional().default(1000),
  options: z.array(OptionSchema)
    .min(2, { message: 'A question must have at least 2 options' })
    .max(6, { message: 'A question cannot exceed 6 options' })
}).refine(data => data.options.some(opt => opt.isCorrect), {
  message: 'At least one option must be marked as correct',
  path: ['options']
});

export type CreateQuizInput = z.infer<typeof CreateQuizSchema>;
export type UpdateQuizInput = z.infer<typeof UpdateQuizSchema>;
export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>;
