"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

type FilterState = {
  text: string;
  requirements: string;
  intent: string;
  category: string;
  tier: string;
  chainId: string;
  sort: string;
};

const categories = [
  ["rebalancing", "Rebalancing"],
  ["grid-trading", "Grid trading"],
  ["yield-optimisation", "Yield optimisation"],
  ["health-factor-monitoring", "Health factor monitoring"],
] as const;

function FilterDropdown({
  name,
  label,
  initialValue,
  options,
}: {
  name: string;
  label: string;
  initialValue: string;
  options: readonly [string, string][];
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <label>
      {label}
      <input type="hidden" name={name} value={value === "all" ? "" : value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([itemValue, itemLabel]) => (
            <SelectItem value={itemValue || "all"} key={itemValue || "all"}>
              {itemLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function FilterForm({
  filters,
  drawer = false,
}: {
  filters: FilterState;
  drawer?: boolean;
}) {
  return (
    <form action="/marketplace" className="marketplace-filter-form">
      <input type="hidden" name="text" value={filters.text} />
      <input type="hidden" name="requirements" value={filters.requirements} />
      <input type="hidden" name="intent" value={filters.intent} />
      <div className="marketplace-filter-heading">
        <div>
          <span className="overline">{drawer ? "Filters" : "Refine results"}</span>
          <h3>{drawer ? "Filters" : "Find the right service"}</h3>
        </div>
      </div>
      <fieldset className="marketplace-category-options">
        <legend>Category</legend>
        <label>
          <input type="radio" name="category" value="" defaultChecked={filters.category === ""} />
          <span>All categories</span>
        </label>
        {categories.map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="category" value={value} defaultChecked={filters.category === value} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <FilterDropdown name="tier" label="Service availability" initialValue={filters.tier || "all"} options={[["all", "Verified services"], ["Working", "Working"], ["Actionable", "Actionable"]]} />
      <FilterDropdown name="chainId" label="Network" initialValue={filters.chainId || "all"} options={[["all", "All networks"], ["56", "BNB Chain"], ["97", "BNB Chain Testnet"]]} />
      <FilterDropdown name="sort" label="Sort results" initialValue={filters.sort} options={[["relevance", "Most relevant"], ["recently-verified", "Recently verified"], ["completed-jobs", "Completed jobs"], ["completion-rate", "Completion rate"]]} />
      <div className="marketplace-filter-actions">
        <Link href="/marketplace">Clear all</Link>
        <Button type="submit">{drawer ? "Show results" : "Apply filters"}</Button>
      </div>
    </form>
  );
}

export function MarketplaceFilters({ filters }: { filters: FilterState }) {
  return (
    <aside className="marketplace-filter-rail">
      <FilterForm filters={filters} />
    </aside>
  );
}

export function MobileMarketplaceFilters({
  filters,
}: {
  filters: FilterState;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mobile-filter-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Open filters"
      >
        <span aria-hidden="true">☰</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="marketplace-filter-dialog">
          <DialogHeader>
            <DialogTitle className="sr-only">Marketplace filters</DialogTitle>
          </DialogHeader>
            <FilterForm filters={filters} drawer />
        </DialogContent>
      </Dialog>
    </>
  );
}
