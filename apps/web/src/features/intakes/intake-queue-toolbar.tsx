"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { FilterDropdown, type FilterDropdownOption } from "@/components/ui/filter-dropdown";
import { scopedPath } from "@/lib/scope";
import { label } from "@/lib/format";

export interface IntakeQueueToolbarProps {
  path: string;
  q: string;
  companyId?: string;
  filter?: string;
  source?: string;
  oldest?: boolean;
  inbox?: boolean;
  sources: readonly string[];
}

export function IntakeQueueToolbar({
  path,
  q: initialQ,
  companyId,
  filter,
  source,
  oldest,
  inbox,
  sources,
}: IntakeQueueToolbarProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState(initialQ);

  const updateFilters = (updates: { q?: string; source?: string; sort?: string }) => {
    const params = new URLSearchParams();
    if (companyId) params.set("company_id", companyId);
    if (filter) params.set("filter", filter);

    const nextQ = updates.q !== undefined ? updates.q : searchTerm;
    const nextSource = updates.source !== undefined ? updates.source : source;
    const nextSort = updates.sort !== undefined ? updates.sort : oldest ? "oldest" : "";

    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextSource) params.set("source", nextSource);
    if (nextSort === "oldest") params.set("sort", "oldest");

    const qs = params.toString();
    const targetUrl = scopedPath(qs ? `${path}?${qs}` : path, companyId);
    router.push(targetUrl);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: searchTerm });
  };

  const handleReset = () => {
    setSearchTerm("");
    const params = new URLSearchParams();
    if (companyId) params.set("company_id", companyId);
    if (filter) params.set("filter", filter);
    const qs = params.toString();
    router.push(scopedPath(qs ? `${path}?${qs}` : path, companyId));
  };

  const sourceOptions: FilterDropdownOption[] = [
    { value: "", label: "All sources" },
    ...sources.map((s) => ({
      value: s,
      label: label(s),
    })),
  ];

  const sortOptions: FilterDropdownOption[] = [
    { value: "", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
  ];

  const hasActiveFilters = Boolean(searchTerm || source || oldest);

  return (
    <div className="flex flex-wrap items-center gap-2.5 py-1 bg-transparent" role="search">
      {/* Search Input: outside table, white background */}
      <form onSubmit={handleSearchSubmit} className="shrink-0 w-full sm:w-64 md:w-72">
        <SearchInput
          maxLength={160}
          aria-label="Search intakes"
          placeholder="Invoice, B/L, company, sender…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          containerClassName="w-full"
          className="h-8 text-xs bg-white dark:bg-card border-input hover:border-border focus:bg-white dark:focus:bg-card shadow-xs"
        />
      </form>

      {/* Modern Source Dropdown (inbox only) - NO CHECKBOX */}
      {inbox && (
        <FilterDropdown
          value={source ?? ""}
          options={sourceOptions}
          onChange={(val) => updateFilters({ source: val })}
        />
      )}

      {/* Modern Sort Dropdown - NO CHECKBOX */}
      <FilterDropdown
        value={oldest ? "oldest" : ""}
        options={sortOptions}
        onChange={(val) => updateFilters({ sort: val })}
      />

      {/* Reset button if filters active */}
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
