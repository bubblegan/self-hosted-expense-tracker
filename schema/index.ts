import { z } from "zod";

export const expenseSchema = z.object({
  description: z.string().trim().min(1),
  categoryId: z.number(),
  amount: z.coerce.number().multipleOf(0.01).max(999999999),
  note: z.string().optional(),
  date: z.date(),
  tags: z.number().array().optional(),
});