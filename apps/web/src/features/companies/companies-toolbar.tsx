"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { FilterDropdown, type FilterDropdownOption } from "@/components/ui/filter-dropdown";

export interface CompaniesToolbarProps {
  query: string;
  order: string;
}

export function CompaniesToolbar({ query: initialQuery, order }: CompaniesToolbarProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState(initialQuery);

  const updateFilters = (updates: { q?: string; sort?: string }) => {
    const params = new URLSearchParams();
    const nextQ = updates.q !== undefined ? updates.q : searchTerm;
    const nextSort = updates.sort !== undefined ? updates.sort : order;

    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextSort === "recent") params.set("sort", "recent");

    const qs = params.toString();
    router.push(qs ? `/companies?${qs}` : "/companies");
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: searchTerm });
  };

  const handleReset = () => {
    setSearchTerm("");
    router.push("/companies");
  };

  const sortOptions: FilterDropdownOption[] = [
    { value: "name", label: "Company name" },
    { value: "recent", label: "Recently added" },
  ];

  const hasActiveFilters = Boolean(searchTerm || order !== "name");

  return (
    <div className="flex flex-wrap items-center gap-2.5 py-1 bg-transparent" role="search">
      <form onSubmit={handleSearchSubmit} className="shrink-0 w-full sm:w-64 md:w-72">
        <SearchInput
          aria-label="Search companies"
          placeholder="Name or identifier…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          maxLength={160}
          containerClassName="w-full"
          className="h-8 text-xs bg-white dark:bg-card border-input hover:border-border focus:bg-white dark:focus:bg-card shadow-xs"
        />
      </form>

      {/* Modern Sort Dropdown - NO CHECKBOX */}
      <FilterDropdown
        value={order}
        options={sortOptions}
        onChange={(val) => updateFilters({ sort: val })}
      />

      {hasActiveFilters && (
        <Button
          type="button"
          onClick={handleReset}
          size="sm"
          variant="ghost"
          className="h-8 text-xs text-muted-foreground hover:text-foreground border-0 shadow-none bg-transparent hover:bg-muted/60"
        >
          <X size={12} className="mr-1" />
          Reset
        </Button>
      )}
    </div>
  );
}
