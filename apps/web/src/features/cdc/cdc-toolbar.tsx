"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { FilterDropdown, type FilterDropdownOption } from "@/components/ui/filter-dropdown";
import { scopedPath } from "@/lib/scope";
import type { MasterVersion } from "@/lib/contracts";

export interface CdcToolbarProps {
  company?: string;
  category?: string;
  q: string;
  versionId: string;
  versions: MasterVersion[];
}

export function CdcToolbar({
  company,
  category,
  q: initialQ,
  versionId,
  versions,
}: CdcToolbarProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState(initialQ);

  const updateFilters = (updates: { q?: string; version?: string }) => {
    const params = new URLSearchParams();
    if (company) params.set("company_id", company);
    if (category) params.set("category", category);

    const nextVersion = updates.version !== undefined ? updates.version : versionId;
    const nextQ = updates.q !== undefined ? updates.q : searchTerm;

    if (nextVersion) params.set("version", nextVersion);
    if (nextQ.trim()) params.set("q", nextQ.trim());

    const qs = params.toString();
    router.push(scopedPath(qs ? `/cdc?${qs}` : "/cdc", company));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: searchTerm });
  };

  const handleReset = () => {
    setSearchTerm("");
    const params = new URLSearchParams();
    if (company) params.set("company_id", company);
    if (versionId) params.set("version", versionId);
    const qs = params.toString();
    router.push(scopedPath(qs ? `/cdc?${qs}` : "/cdc", company));
  };

  const versionOptions: FilterDropdownOption[] = versions.map((v) => ({
    value: v.id,
    label: `${v.company} · ${v.year} · ${v.approval_ref}`,
  }));

  const hasActiveFilters = Boolean(searchTerm || category);

  return (
    <div className="flex flex-wrap items-center gap-2.5 py-1 bg-transparent" role="search">
      <form onSubmit={handleSearchSubmit} className="shrink-0 w-full sm:w-64 md:w-72">
        <SearchInput
          aria-label="Find workbook rows"
          placeholder="Description or row number…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          maxLength={160}
          containerClassName="w-full"
          className="h-8 text-xs bg-white dark:bg-card border-input hover:border-border focus:bg-white dark:focus:bg-card shadow-xs"
        />
      </form>

      {/* Modern Workbook Dropdown - NO CHECKBOX */}
      <FilterDropdown
        label="Workbook"
        value={versionId}
        options={versionOptions}
        onChange={(val) => updateFilters({ version: val })}
        className="max-w-xs"
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
