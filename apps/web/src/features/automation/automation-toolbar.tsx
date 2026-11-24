"use client";

import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterDropdown, type FilterDropdownOption } from "@/components/ui/filter-dropdown";
import { scopedPath } from "@/lib/scope";
import { label } from "@/lib/format";

export interface AutomationToolbarProps {
  companyId?: string;
  filter: string;
  states: string[];
}

export function AutomationToolbar({ companyId, filter, states }: AutomationToolbarProps) {
  const router = useRouter();

  const handleStateChange = (val: string) => {
    const params = new URLSearchParams();
    if (companyId) params.set("company_id", companyId);
    if (val) params.set("state", val);

    const qs = params.toString();
    router.push(scopedPath(qs ? `/automation?${qs}` : "/automation", companyId));
  };

  const handleReset = () => {
    router.push(scopedPath("/automation", companyId));
  };

  const statusOptions: FilterDropdownOption[] = [
    { value: "", label: "All statuses" },
    ...states.map((s) => ({
      value: s,
      label: label(s),
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2.5 py-1 bg-transparent">
      {/* Modern Status Dropdown - NO CHECKBOX */}
      <FilterDropdown
        value={filter}
        options={statusOptions}
        onChange={handleStateChange}
      />

      {filter && (
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
