import { useCompletion } from "ai/react";

export function useCategoriseCompletion(onFinish: (parsedData: Record<string, string>) => void) {
  const { complete, isLoading, completion } = useCompletion({
    onFinish: (_, completion) => {
      const categorisedRecord: Record<string, string> = {};
      completion?.split("\n").forEach((line) => {
        const data = line.split(",");
        categorisedRecord[data[0]] = data[3];
      });
      onFinish(categorisedRecord);
    },
  });

  return {
    complete,
    isLoading,
    completion,
  };
}
