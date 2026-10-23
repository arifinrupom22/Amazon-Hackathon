import { useMemo, useState } from "react";
import { Check, Package, Plus, ShoppingBasket, Trash2, Undo2 } from "lucide-react";
import { useAppState } from "../state/store";
import { ConfirmButton, EmptyState, LoadingRows, StatCard } from "../components/ui";
import type { GroceryItem } from "../lib/types";

export function Groceries() {
  const { groceries, loading, addGrocery, togglePurchased, deleteGrocery } = useAppState();
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toBuy = groceries.filter((item) => !item.purchased);
  const purchased = groceries.filter((item) => item.purchased);

  const grouped = useMemo(() => {
    const map = new Map<string, GroceryItem[]>();
    for (const item of toBuy) {
      const key = item.category ?? "General";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [toBuy]);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addGrocery({
        name: name.trim(),
        quantity: Number(quantity) || 1,
        unit: unit.trim() || null,
        category: category.trim() || null,
      });
      setName("");
      setQuantity("1");
      setUnit("");
      setCategory("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-[1080px] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Grocery List</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {toBuy.length} to buy · {purchased.length} purchased
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-2">
            <div className="w-[150px]">
              <StatCard label="To buy" value={toBuy.length} icon={<ShoppingBasket size={14} />} />
            </div>
            <div className="w-[150px]">
              <StatCard label="In cart" value={purchased.length} icon={<Package size={14} />} />
            </div>
          </div>
        </header>

        {loading ? (
          <LoadingRows rows={4} label="Loading groceries" />
        ) : toBuy.length === 0 ? (
          <EmptyState
            icon={<ShoppingBasket size={18} />}
            title="Nothing left to buy"
            description="Add an item on the right, or approve a plan that stages groceries for a meal."
          />
        ) : (
          <div className="space-y-4">
            {grouped.map(([group, items]) => (
              <section key={group} className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2">
                  <h3 className="text-[12.5px] font-semibold uppercase tracking-[0.06em] text-muted">{group}</h3>
                  <span className="tnum text-[11.5px] text-muted">{items.length}</span>
                </div>
                <ul className="divide-y divide-line">
                  {items.map((item) => (
                    <li key={item.id} className="group flex items-center gap-3 px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => void togglePurchased(item)}
                        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-muted bg-surface transition hover:border-accent"
                        aria-label={`Mark ${item.name} as purchased`}
                      >
                        <Check size={12} className="text-transparent" aria-hidden="true" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium text-ink">{item.name}</p>
                        <p className="text-[12px] text-muted">
                          {item.quantity}
                          {item.unit ? ` ${item.unit}` : ""}
                          {item.notes ? ` · ${item.notes}` : ""}
                        </p>
                      </div>
                      {item.source === "plan" ? (
                        <span className="chip chip-accent shrink-0" style={{ height: 20, fontSize: 11 }}>
                          from plan
                        </span>
                      ) : null}
                      <ConfirmButton
                        onConfirm={() => deleteGrocery(item.id)}
                        confirmTitle="Remove item?"
                        confirmBody={`${item.name} will be removed from the list. This calls remove_grocery_item with confirm: true.`}
                        confirmLabel="Remove item"
                        className="btn btn-ghost btn-sm shrink-0 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </ConfirmButton>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {purchased.length > 0 ? (
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2">
              <h3 className="text-[12.5px] font-semibold uppercase tracking-[0.06em] text-muted">Purchased</h3>
              <span className="tnum text-[11.5px] text-muted">{purchased.length}</span>
            </div>
            <ul className="divide-y divide-line">
              {purchased.map((item) => (
                <li key={item.id} className="group flex items-center gap-3 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => void togglePurchased(item)}
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-accent bg-accent text-white"
                    aria-label={`Move ${item.name} back to the shopping list`}
                  >
                    <Check size={12} aria-hidden="true" />
                  </button>
                  <p className="min-w-0 flex-1 truncate text-[13.5px] text-muted line-through">{item.name}</p>
                  <button
                    type="button"
                    onClick={() => void togglePurchased(item)}
                    className="btn btn-ghost btn-sm opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Undo2 size={13} aria-hidden="true" />
                    Un-buy
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <aside className="min-w-0 space-y-4">
        <form
          className="card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h3 className="text-[14px] font-semibold text-ink">Add an item</h3>
          <p className="mt-0.5 text-[12px] text-muted">Runs add_grocery_item (duplicates merge)</p>
          <div className="mt-3 space-y-2.5">
            <input
              className="field"
              placeholder="Item name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Item name"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="field tnum"
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                aria-label="Quantity"
              />
              <input
                className="field"
                placeholder="Unit (kg, cans…)"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                aria-label="Unit"
              />
            </div>
            <input
              className="field"
              placeholder="Category (Produce, Pantry…)"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              aria-label="Category"
            />
            {error ? <p className="text-[12.5px] text-error">{error}</p> : null}
            <button type="submit" className="btn btn-primary w-full" disabled={!name.trim() || busy}>
              <Plus size={15} aria-hidden="true" />
              Add to list
            </button>
          </div>
        </form>

        <div className="card p-4">
          <h3 className="text-[14px] font-semibold text-ink">Purchase state is persisted</h3>
          <p className="mt-1 text-[12.5px] leading-5 text-muted">
            Marking an item purchased calls{" "}
            <span className="font-mono text-[11.5px]">mark_grocery_item_purchased</span> and stores the timestamp in
            PostgreSQL, so it survives a reload or a full server restart.
          </p>
        </div>
      </aside>
    </div>
  );
}
