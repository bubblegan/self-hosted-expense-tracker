import { prisma } from "@/utils/prisma";
import { z } from "zod";
import { expenseSchema } from "../../schema";
import { protectedProcedure, router } from "../trpc";

type CategoryAmount = {
  id?: number;
  sum: string;
  title?: string;
  color?: string;
};

export const expenseRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().optional(),
        statementIds: z.number().array().optional(),
        categoryIds: z.number().array().optional(),
        tagIds: z.number().array().optional(),
        keyword: z.string().optional(),
        uncategorised: z.boolean().optional(),
        dateRange: z
          .object({
            start: z.date().nullable(),
            end: z.date().nullable(),
          })
          .optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const result = await prisma.expense.findMany({
        where: {
          ...(input.statementIds && input.statementIds?.length > 0
            ? { statementId: { in: input.statementIds } }
            : {}),
          ...(input.categoryIds && input.categoryIds?.length > 0
            ? {
                categoryId: { in: input.categoryIds },
              }
            : {}),
          ...(input.tagIds && input.tagIds?.length > 0
            ? {
                tags: {
                  some: {
                    tagId: {
                      in: input.tagIds,
                    },
                  },
                },
              }
            : {}),
          ...(input.uncategorised
            ? {
                categoryId: null,
              }
            : {}),
          ...(input.dateRange?.start && input.dateRange?.end
            ? {
                date: {
                  gte: input.dateRange.start,
                  lte: input.dateRange.end,
                },
              }
            : {}),
          ...(input.keyword
            ? {
                description: {
                  contains: input.keyword,
                  mode: "insensitive",
                },
              }
            : {}),
          userId: ctx.auth.userId,
        },
        include: {
          Category: true,
          Statement: {
            select: {
              name: true,
            },
          },
          tags: true,
        },
        orderBy: { date: "desc" },
      });

      return result;
    }),
  categorise: protectedProcedure
    .input(
      z.array(
        z.object({
          expenseId: z.number(),
          categoryId: z.number(),
        })
      )
    )
    .mutation(async ({ input }) => {
      const sqlIds: string[] = [];
      const sqlUpdatedExpense: string[] = [];

      input.forEach((expense) => {
        const expenseId = expense.expenseId.toString();
        const categoryId = expense.categoryId.toString();

        sqlIds.push(expenseId);
        sqlUpdatedExpense.push(`WHEN id = ${expenseId} THEN ${categoryId}`);
      });

      const bulkUpdateCategoryResult = await prisma.$executeRawUnsafe<CategoryAmount[]>(`
        UPDATE "Expense"
        SET 
            "categoryId" = CASE 
                ${sqlUpdatedExpense.join(" ")} 
            END
        WHERE "Expense"."id" IN (${sqlIds.join(", ")});
      `);

      return bulkUpdateCategoryResult;
    }),
  tagMany: protectedProcedure
    .input(
      z.array(
        z.object({
          expenseId: z.number(),
          tagIds: z.number().array(),
        })
      )
    )
    .mutation(async ({ input, ctx }) => {
      const promises = input.map((line) => {
        return prisma.expense.update({
          where: {
            id: line.expenseId,
            userId: ctx.auth.userId,
          },
          data: {
            tags: {
              deleteMany: {},
              create: line.tagIds?.map((tag) => {
                return {
                  assignedAt: new Date(),
                  tag: {
                    connect: {
                      id: tag,
                    },
                  },
                };
              }),
            },
          },
        });
      });

      const result = await Promise.all(promises);

      return result;
    }),
  aggregateByMonth: protectedProcedure
    .input(
      z.object({
        start: z.date().nullable(),
        end: z.date().nullable(),
      })
    )
    .query(async ({ input, ctx }) => {
      const { start, end } = input;
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const result = await prisma.$queryRaw<{ title: string; amount: number; count: bigint }[]>`
        Select date_trunc('month', "Expense"."date" at time zone 'UTC' at time zone ${timeZone}) AS "title", SUM("Expense"."amount") AS "amount", COUNT("Expense"."amount") as count
        From "Expense" 
        WHERE "Expense"."date" BETWEEN ${start} AND ${end} AND "Expense"."userId" = ${ctx.auth.userId}
        GROUP BY "title"
        ORDER BY "title" ASC
    `;

      return result;
    }),
  distinctYear: protectedProcedure.query(async () => {
    const result = await prisma.$queryRaw<{ year: number }[]>`
       SELECT DISTINCT EXTRACT(YEAR FROM "Expense"."date") AS year
       FROM "Expense" ORDER BY year DESC;
    `;

    return result;
  }),
  update: protectedProcedure
    .input(expenseSchema.extend({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const { description, categoryId, amount, note, date, tags } = input;
      const result = await prisma.expense.update({
        where: {
          id: input.id,
          userId: ctx.auth.userId,
        },
        data: {
          description,
          categoryId,
          amount,
          note,
          date,
          tags: {
            deleteMany: {},
            create: tags?.map((tag) => {
              return {
                assignedAt: new Date(),
                tag: {
                  connect: {
                    id: tag,
                  },
                },
              };
            }),
          },
        },
      });

      return result;
    }),
  create: protectedProcedure.input(expenseSchema).mutation(async ({ input, ctx }) => {
    const { description, categoryId, amount, note, date, tags } = input;
    const result = await prisma.expense.create({
      data: {
        description,
        categoryId,
        amount,
        note,
        date,
        userId: ctx.auth.userId,
        tags: {
          create: tags?.map((tag) => {
            return {
              assignedAt: new Date(),
              tag: {
                connect: {
                  id: tag,
                },
              },
            };
          }),
        },
      },
    });

    return result;
  }),
  delete: protectedProcedure.input(z.number().array()).mutation(async ({ input, ctx }) => {
    const result = await prisma.expense.deleteMany({
      where: {
        id: {
          in: input,
        },
        userId: ctx.auth.userId,
      },
    });
    return result;
  }),
});
