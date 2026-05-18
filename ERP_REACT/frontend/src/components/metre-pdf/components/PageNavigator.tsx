import { useMetreStore } from '../store';
import { useCallback, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function PageNavigator() {
  const currentPage = useMetreStore((s) => s.currentPage);
  const setCurrentPage = useMetreStore((s) => s.setCurrentPage);
  const document = useMetreStore((s) => s.document);

  const totalPages = document?.pageCount ?? 1;
  const [inputValue, setInputValue] = useState(String(currentPage));

  // Sync input when page changes externally
  useEffect(() => {
    setInputValue(String(currentPage));
  }, [currentPage]);

  const goToPrev = useCallback(() => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  }, [currentPage, setCurrentPage]);

  const goToNext = useCallback(() => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  }, [currentPage, totalPages, setCurrentPage]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
    },
    []
  );

  const handleInputSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const page = parseInt(inputValue, 10);
      if (!isNaN(page) && page >= 1 && page <= totalPages) {
        setCurrentPage(page);
      } else {
        setInputValue(String(currentPage));
      }
    },
    [inputValue, totalPages, currentPage, setCurrentPage]
  );

  if (!document) return null;

  return (
    <div className="h-8 bg-metre-surface border-t border-metre-border flex items-center justify-center gap-2 flex-shrink-0">
      <button
        className="tool-btn w-6 h-6"
        onClick={goToPrev}
        disabled={currentPage <= 1}
        title="Page precedente"
      >
        <ChevronLeft
          size={16}
          className={currentPage <= 1 ? 'opacity-30' : ''}
        />
      </button>

      <form onSubmit={handleInputSubmit} className="flex items-center gap-1">
        <input
          className="w-10 h-5 text-center text-xs bg-metre-bg border border-metre-border rounded text-metre-text focus:outline-none focus:border-metre-accent tabular-nums"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputSubmit}
        />
        <span className="text-xs text-metre-muted">/ {totalPages}</span>
      </form>

      <button
        className="tool-btn w-6 h-6"
        onClick={goToNext}
        disabled={currentPage >= totalPages}
        title="Page suivante"
      >
        <ChevronRight
          size={16}
          className={currentPage >= totalPages ? 'opacity-30' : ''}
        />
      </button>
    </div>
  );
}
