import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DocumentsPaginationProps {
  canGoBack: boolean;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function DocumentsPagination({ canGoBack, hasMore, onPrev, onNext }: DocumentsPaginationProps) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button type="button" variant="outline" size="sm" disabled={!canGoBack} onClick={onPrev}>
        <ChevronLeft />
        Previous
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={!hasMore} onClick={onNext}>
        Next
        <ChevronRight />
      </Button>
    </div>
  );
}
