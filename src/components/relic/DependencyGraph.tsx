"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Background, Controls, MiniMap, ReactFlow, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createFlowGraph } from "@/lib/relic/graph";
import type { ReviewResult, SystemComponent } from "@/lib/relic/types";

export function DependencyGraph({ review }: { review: ReviewResult }) {
  const graph = useMemo(() => createFlowGraph(review), [review]);
  const reduceMotion = useReducedMotion();
  const [selected, setSelected] = useState<SystemComponent | undefined>(
    review.components.find((component) => component.id === review.changeRequest.affectedComponentId),
  );

  return (
    <section>
      <p className="mb-5 text-sm text-muted">Impact path generated from dependency traversal of the proposed policy change.</p>
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="review-flow-ready h-[620px] border border-line bg-raised">
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            fitView
            minZoom={0.35}
            onNodeClick={(_, node: Node) => {
              const component = review.components.find((item) => item.id === node.id);
              setSelected(component);
            }}
          >
            <Background color="#D9D7CF" gap={28} />
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
            <Controls />
          </ReactFlow>
        </div>
        <aside className="border border-line bg-raised p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">Component detail</div>
          {selected ? (
            <motion.div
              key={selected.id}
              className="mt-5"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            >
              <h2 className="text-2xl font-semibold tracking-tight">{selected.name}</h2>
              <p className="mt-3 text-sm leading-6 text-muted">{selected.description}</p>
              <dl className="mt-6 space-y-4 text-sm">
                <div className="border-t border-line pt-3">
                  <dt className="text-muted">Owner</dt>
                  <dd className="mt-1 font-medium">{selected.owner}</dd>
                </div>
                <div className="border-t border-line pt-3">
                  <dt className="text-muted">Criticality</dt>
                  <dd className="mt-1 font-medium">{selected.criticality}</dd>
                </div>
                <div className="border-t border-line pt-3">
                  <dt className="text-muted">Source</dt>
                  <dd className="mt-1 font-mono text-xs">{selected.sourceReference}</dd>
                </div>
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                {selected.tags.map((tag) => (
                  <span key={tag} className="border border-line px-2 py-1 text-xs text-muted">{tag}</span>
                ))}
              </div>
            </motion.div>
          ) : null}
          <div className="mt-8 border-t border-line pt-4 text-xs text-muted">
            <div className="mb-2"><span className="mr-2 inline-block h-2 w-5 bg-moss" />Impacted component</div>
            <div><span className="mr-2 inline-block h-2 w-5 bg-blocked" />Critical branch</div>
          </div>
        </aside>
      </div>
    </section>
  );
}
