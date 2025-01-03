import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/router";
import { Input } from "@/ui/input";
import { useDebounceValue } from "@/utils/hooks/use-debounce-value";

const KeywordSearch = () => {
  const [value, setValue] = useState("");
  const router = useRouter();

  const debounceValue = useDebounceValue(value, 500);
  const params = useSearchParams();
  const keywordParam = params.get("keyword");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (debounceValue) {
      params.set("keyword", debounceValue);
      router.push(`/expenses?${params.toString()}`, undefined, {
        shallow: true,
      });
    } else if (params.get("keyword")) {
      params.delete("keyword");
      router.push(`/expenses?${params.toString()}`, undefined, {
        shallow: true,
      });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounceValue]);

  useEffect(() => {
    if (keywordParam !== value) {
      setValue(keywordParam || "");
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywordParam]);

  return (
    <Input
      className="h-10"
      onChange={(e) => {
        setValue(e.target.value);
      }}
      value={value}
      placeholder="Search Expenses.."
    />
  );
};

export default KeywordSearch;
