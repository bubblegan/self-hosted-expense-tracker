import { getExpenseFilterParam } from "../get-expense-filter-params";
import { trpc } from "../trpc";

export function useHandleExpenseFetch() {
  const { statementIds, start, end, keyword, categoryIds, uncategorised, tagIds, page, per, orderBy, dir } =
    getExpenseFilterParam();

  const result = trpc.expense.list.useQuery({
    statementIds,
    dateRange: {
      start,
      end,
    },
    tagIds,
    keyword,
    categoryIds,
    uncategorised,
    page,
    per,
    ...(orderBy && (dir === "asc" || dir === "desc") ? { order: { by: orderBy, direction: dir } } : {}),
  });

  const expensesResult = result.data?.result || [];
  const aggregateResult = result.data?.aggregateResult;

  return {
    amount: aggregateResult?._sum.amount || 0,
    totalCount: aggregateResult?._count.id || 0,
    expenses: expensesResult,
  };
}
