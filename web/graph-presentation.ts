import type { Graph, GraphEdge, GraphNode } from "../shared/types";

export interface GraphLayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
  /** Maximum peer rows before another parallel column is used in the same rank. */
  parallelRows?: number;
  /** Existing manual coordinates win; they may overlap automatic positions. */
  preservePositions?: boolean;
  includeHidden?: boolean;
}
export interface PresentationComponent {
  id: string;
  nodeIds: string[];
  cyclic: boolean;
  rank: number;
}
export interface PresentationColumn {
  /** Relationship depth in the overview, not an execution step or temporal order. */
  rank: number;
  x: number;
  width: number;
  nodeIds: string[];
  parallel: boolean;
}
export interface GraphPresentation {
  positions: Record<string, { x: number; y: number }>;
  rankByNode: Record<string, number>;
  /** Original representative objects for every visible ordered endpoint pair. */
  displayedEdges: GraphEdge[];
  /** A connected spanning overview, plus a cycle-closing relationship where available. */
  primaryEdgeIds: Set<string>;
  /** Routing hints for return/cycle edges; original kind and provenance remain unchanged. */
  feedbackEdgeIds: Set<string>;
  /** Number of deduplicated representatives omitted from the primary overview. */
  secondaryEdgeCount: number;
  /** Original visible relationships, including parallel duplicates. */
  totalEdgeCount: number;
  /** Representative ID -> every original parallel relationship ID, representative first. */
  relationshipGroups: Record<string, string[]>;
  components: PresentationComponent[];
  columns: PresentationColumn[];
}

/**
 * External-run presentation only: show evidence that was actually recorded.
 * A source relationship never becomes an observed relationship by proximity.
 * Endpoint-only or unknown nodes are not invented to complete a source graph.
 */
export function recordedGraph(
  graph: Graph,
  events: readonly { nodeId?: string }[],
): Graph {
  const referenced = new Set(
    events.flatMap((event) => (event.nodeId ? [event.nodeId] : [])),
  );
  const nodes = graph.nodes
    .filter((node) => referenced.has(node.id))
    .map((node) => ({ ...node, hidden: false }));
  const visible = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) =>
      edge.provenance === "observed" &&
      visible.has(edge.source) &&
      visible.has(edge.target),
  );
  return structuredClone({ ...graph, nodes, edges });
}

/**
 * Reduce relationships only for an imported, unobserved source overview.
 * Executable manifests and recorded runs preserve all visible original edges,
 * including parallel edges and every feedback contract. Callers must pass false
 * for recorded executions even when their project has an imported repository.
 */
export function selectPresentationEdges(
  graph: Graph,
  presentation: Pick<GraphPresentation, "primaryEdgeIds">,
  detail: "overview" | "all",
  isImportedSource: boolean,
): GraphEdge[] {
  const visible = new Set(
    graph.nodes.filter((node) => !node.hidden).map((node) => node.id),
  );
  return graph.edges.filter(
    (edge) =>
      visible.has(edge.source) &&
      visible.has(edge.target) &&
      (detail === "all" ||
        !isImportedSource ||
        edge.kind === "feedback" ||
        presentation.primaryEdgeIds.has(edge.id)),
  );
}

const roles: Record<string, number> = {
  orchestrator: 0,
  agent: 1,
  validator: 2,
  guardrail: 3,
  tool: 4,
  output: 5,
  opaque: 6,
  resource: 7,
};
const numberOption = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

/**
 * A presentation of existing evidence, never a rewrite of the application graph.
 * Overview retains weak connectivity using the strongest source relationships first.
 * All relationships and duplicate membership remain available for inspection.
 */
export function layoutGraph(
  graph: Graph,
  options: GraphLayoutOptions = {},
): GraphPresentation {
  const nodeWidth = numberOption(options.nodeWidth, 244),
    nodeHeight = numberOption(options.nodeHeight, 160),
    horizontalGap = numberOption(options.horizontalGap, 120),
    verticalGap = numberOption(options.verticalGap, 65),
    parallelRows = Math.max(
      1,
      Math.floor(numberOption(options.parallelRows, 4)),
    );
  const nodes = graph.nodes.filter(
    (node) => options.includeHidden || !node.hidden,
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const compareNode = (a: string, b: string) => {
    const left = byId.get(a)!,
      right = byId.get(b)!;
    return (
      (roles[left.role] ?? 8) - (roles[right.role] ?? 8) ||
      left.label.localeCompare(right.label) ||
      a.localeCompare(b)
    );
  };
  const nodeIds = nodes.map((node) => node.id).sort(compareNode);
  const rawEdges = graph.edges.filter(
    (edge) => byId.has(edge.source) && byId.has(edge.target),
  );
  const incoming = new Map<string, Set<string>>();
  for (const edge of rawEdges) {
    const set = incoming.get(edge.target) || new Set<string>();
    set.add(edge.source);
    incoming.set(edge.target, set);
  }
  const genericModelCall = (edge: GraphEdge) => {
    const target = byId.get(edge.target)!;
    return (
      /provider|client wrapper|model gateway|llm client/i.test(target.label) ||
      (target.role === "tool" &&
        (incoming.get(target.id)?.size || 0) >= 3 &&
        /model|llm|client/i.test(target.label)) ||
      /(?:claude|gemini|openai|anthropic|runtime)\.(?:structured|text)|messages\.create|responses\.create|chat\.completions|generateContent/i.test(
        edge.label,
      )
    );
  };
  const score = (edge: GraphEdge) => {
    if (edge.provenance === "observed") return 0;
    if (edge.kind === "dependency") return 100;
    if (edge.provenance === "declared") return 10;
    const source = byId.get(edge.source)!,
      target = byId.get(edge.target)!;
    if (genericModelCall(edge))
      return (
        80 +
        (source.role === "orchestrator"
          ? 0
          : source.role === "validator"
            ? 1
            : 2)
      );
    if (source.role === "orchestrator" && target.role === "orchestrator")
      return 20;
    if (source.role === "orchestrator") return 30;
    if (edge.kind === "feedback") return 40;
    return 50;
  };
  const compareEdge = (a: GraphEdge, b: GraphEdge) =>
    score(a) - score(b) ||
    (incoming.get(a.source)?.size || 0) - (incoming.get(b.source)?.size || 0) ||
    compareNode(a.source, b.source) ||
    compareNode(a.target, b.target) ||
    a.id.localeCompare(b.id);
  const pairs = new Map<string, GraphEdge[]>();
  for (const edge of rawEdges) {
    const key = JSON.stringify([edge.source, edge.target]);
    const group = pairs.get(key) || [];
    group.push(edge);
    pairs.set(key, group);
  }
  const relationshipGroups: Record<string, string[]> = {};
  const displayedEdges = [...pairs.values()]
    .map((group) => {
      const ordered = [...group].sort(compareEdge);
      relationshipGroups[ordered[0].id] = ordered.map((edge) => edge.id);
      return ordered[0];
    })
    .sort(compareEdge);

  // Kruskal over the undirected projection chooses existing evidence, never invented links.
  const leaders = new Map(nodeIds.map((id) => [id, id]));
  const leader = (id: string): string => {
    const parent = leaders.get(id)!;
    if (parent !== id) leaders.set(id, leader(parent));
    return leaders.get(id)!;
  };
  const primaryEdgeIds = new Set<string>();
  for (const edge of displayedEdges) {
    const source = leader(edge.source),
      target = leader(edge.target);
    if (source === target) continue;
    leaders.set(target, source);
    primaryEdgeIds.add(edge.id);
  }
  // One evidenced return relation exposes a loop instead of silently presenting it as a DAG.
  const observedControl = displayedEdges.filter(
    (edge) => edge.provenance === "observed" && edge.kind !== "dependency",
  );
  // Static cycles must not be presented as if they occurred in an observed run.
  const control = observedControl.length
    ? observedControl
    : displayedEdges.filter((edge) => edge.kind !== "dependency");
  const originalComponents = stronglyConnected(nodeIds, control, compareNode);
  for (const component of originalComponents) {
    const members = new Set(component);
    const internal = control.filter(
      (edge) => members.has(edge.source) && members.has(edge.target),
    );
    if (
      component.length === 1 &&
      !internal.some((edge) => edge.source === edge.target)
    )
      continue;
    const selected = displayedEdges.filter((edge) =>
      primaryEdgeIds.has(edge.id),
    );
    const closing =
      internal.find(
        (edge) =>
          !primaryEdgeIds.has(edge.id) &&
          reachable(edge.target, edge.source, selected),
      ) || internal.find((edge) => !primaryEdgeIds.has(edge.id));
    if (closing) primaryEdgeIds.add(closing.id);
  }
  const primary = displayedEdges.filter((edge) => primaryEdgeIds.has(edge.id));
  const groups = stronglyConnected(nodeIds, primary, compareNode);
  const componentOf = new Map<string, number>();
  groups.forEach((members, index) =>
    members.forEach((id) => componentOf.set(id, index)),
  );
  const predecessors = groups.map(() => new Set<number>()),
    successors = groups.map(() => new Set<number>());
  for (const edge of primary) {
    const source = componentOf.get(edge.source)!,
      target = componentOf.get(edge.target)!;
    if (source !== target) {
      successors[source].add(target);
      predecessors[target].add(source);
    }
  }
  const componentOrder = (a: number, b: number) =>
    compareNode(groups[a][0], groups[b][0]);
  const pending = predecessors.map((set) => set.size),
    ranks = groups.map(() => 0);
  const queue = groups
    .map((_, index) => index)
    .filter((index) => pending[index] === 0)
    .sort(componentOrder);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const next of [...successors[current]].sort(componentOrder)) {
      ranks[next] = Math.max(ranks[next], ranks[current] + 1);
      if (--pending[next] === 0) queue.push(next);
    }
  }
  const layers = Array.from(
    { length: groups.length ? Math.max(...ranks) + 1 : 0 },
    () => [] as number[],
  );
  groups.forEach((_, index) => layers[ranks[index]].push(index));
  layers.forEach((layer) => layer.sort(componentOrder));
  // Alternating barycentric sweeps reduce crossings without adding ordering constraints.
  for (let sweep = 0; sweep < 4; sweep++) {
    const order = new Map<number, number>();
    layers.forEach((layer) =>
      layer.forEach((component, index) =>
        order.set(component, (index + 0.5) / layer.length),
      ),
    );
    const downward = sweep % 2 === 0;
    const sequence = downward ? layers : [...layers].reverse();
    for (const layer of sequence) {
      const neighbors = downward ? predecessors : successors;
      const center = (index: number) => {
        const values = [...neighbors[index]].map((neighbor) =>
          order.get(neighbor)!,
        );
        return values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : order.get(index)!;
      };
      layer.sort((a, b) => center(a) - center(b) || componentOrder(a, b));
      layer.forEach((component, index) =>
        order.set(component, (index + 0.5) / layer.length),
      );
    }
  }
  const local = groups.map((members) =>
    componentLayout(members, primary, compareNode, parallelRows),
  );
  const positions: GraphPresentation["positions"] = {};
  const rankByNode: Record<string, number> = {};
  const columns: PresentationColumn[] = [];
  const layerHeights: number[] = [];
  let x = 0;
  for (let rank = 0; rank < layers.length; rank++) {
    const layer = layers[rank];
    // Pack component rectangles into a compact parallel band. A small loop must
    // not reserve a whole empty column beside unrelated peers in the same rank.
    const area = layer.reduce(
      (sum, component) =>
        sum + local[component].rows * local[component].columns,
      0,
    );
    let columnCount = Math.max(
      1,
      ...layer.map((component) => local[component].columns),
      Math.ceil(area / parallelRows),
    );
    let packed = new Map<number, { x: number; y: number }>();
    for (;;) {
      packed = new Map();
      const occupied = new Set<string>();
      const packingOrder = [...layer].sort(
        (a, b) =>
          local[b].columns - local[a].columns || local[b].rows - local[a].rows,
      );
      for (const component of packingOrder) {
        const box = local[component];
        let found = false;
        for (
          let column = 0;
          column + box.columns <= columnCount && !found;
          column++
        ) {
          for (let row = 0; row + box.rows <= parallelRows && !found; row++) {
            const cells = Array.from({ length: box.columns }, (_, dx) =>
              Array.from(
                { length: box.rows },
                (_, dy) => `${column + dx}:${row + dy}`,
              ),
            ).flat();
            if (cells.some((cell) => occupied.has(cell))) continue;
            cells.forEach((cell) => occupied.add(cell));
            packed.set(component, { x: column, y: row });
            found = true;
          }
        }
        if (!found) break;
      }
      if (packed.size === layer.length) break;
      columnCount++;
    }
    const layerX = x;
    let height = 0;
    for (const component of layer) {
      const box = packed.get(component)!;
      for (const [id, point] of Object.entries(local[component].positions)) {
        positions[id] = {
          x: x + (box.x + point.x) * (nodeWidth + horizontalGap),
          y: (box.y + point.y) * (nodeHeight + verticalGap),
        };
        rankByNode[id] = rank;
      }
      height = Math.max(
        height,
        (box.y + local[component].rows) * (nodeHeight + verticalGap) -
          verticalGap,
      );
    }
    x += columnCount * (nodeWidth + horizontalGap);
    layerHeights.push(height);
    columns.push({
      rank,
      x: layerX,
      width: x - layerX - horizontalGap,
      nodeIds: layer.flatMap((component) => groups[component]),
      parallel: layer.length > 1,
    });
  }
  const fullHeight = Math.max(0, ...layerHeights);
  for (const [id, position] of Object.entries(positions))
    position.y += (fullHeight - layerHeights[rankByNode[id]]) / 2;
  if (options.preservePositions)
    for (const node of nodes) {
      if (
        node.position &&
        Number.isFinite(node.position.x) &&
        Number.isFinite(node.position.y)
      )
        positions[node.id] = { ...node.position };
    }
  const feedbackEdgeIds = new Set(
    displayedEdges
      .filter(
        (edge) =>
          edge.kind === "feedback" ||
          positions[edge.target].x <= positions[edge.source].x,
      )
      .map((edge) => edge.id),
  );
  return {
    positions,
    rankByNode,
    displayedEdges,
    primaryEdgeIds,
    feedbackEdgeIds,
    secondaryEdgeCount: displayedEdges.length - primaryEdgeIds.size,
    totalEdgeCount: rawEdges.length,
    relationshipGroups,
    columns,
    components: groups.map((members, index) => ({
      id: `component:${members[0]}`,
      nodeIds: members,
      rank: ranks[index],
      cyclic:
        members.length > 1 ||
        primary.some(
          (edge) => edge.source === members[0] && edge.target === members[0],
        ),
    })),
  };
}

function reachable(from: string, to: string, edges: GraphEdge[]) {
  const seen = new Set<string>(),
    queue = [from];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current === to) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of edges)
      if (edge.source === current && !seen.has(edge.target))
        queue.push(edge.target);
  }
  return false;
}

function stronglyConnected(
  ids: string[],
  edges: GraphEdge[],
  compare: (a: string, b: string) => number,
) {
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) adjacency.get(edge.source)!.push(edge.target);
  adjacency.forEach((neighbors) => neighbors.sort(compare));
  const discovered = new Map<string, number>(),
    lowest = new Map<string, number>();
  const active = new Set<string>(),
    stack: string[] = [],
    components: string[][] = [];
  let sequence = 0;
  const visit = (id: string) => {
    discovered.set(id, sequence);
    lowest.set(id, sequence++);
    stack.push(id);
    active.add(id);
    for (const next of adjacency.get(id)!) {
      if (!discovered.has(next)) {
        visit(next);
        lowest.set(id, Math.min(lowest.get(id)!, lowest.get(next)!));
      } else if (active.has(next))
        lowest.set(id, Math.min(lowest.get(id)!, discovered.get(next)!));
    }
    if (lowest.get(id) !== discovered.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      active.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component.sort(compare));
  };
  ids.forEach((id) => {
    if (!discovered.has(id)) visit(id);
  });
  return components.sort((a, b) => compare(a[0], b[0]));
}

function componentLayout(
  ids: string[],
  edges: GraphEdge[],
  compare: (a: string, b: string) => number,
  parallelRows: number,
) {
  const members = new Set(ids),
    depths = new Map<string, number>();
  const entryTargets = edges
    .filter((edge) => !members.has(edge.source) && members.has(edge.target))
    .map((edge) => edge.target)
    .sort(compare);
  const seed = entryTargets[0] || ids[0],
    queue = [seed];
  depths.set(seed, 0);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const target of edges
      .filter((edge) => edge.source === current && members.has(edge.target))
      .map((edge) => edge.target)
      .sort(compare)) {
      if (depths.has(target)) continue;
      depths.set(target, depths.get(current)! + 1);
      queue.push(target);
    }
  }
  const layers = new Map<number, string[]>();
  for (const id of ids) {
    const depth = depths.get(id) || 0,
      layer = layers.get(depth) || [];
    layer.push(id);
    layers.set(depth, layer);
  }
  const positions: Record<string, { x: number; y: number }> = {};
  let columns = 0,
    rows = 1;
  for (const [, layer] of [...layers.entries()].sort(([a], [b]) => a - b)) {
    layer.sort(compare).forEach((id, index) => {
      positions[id] = {
        x: columns + Math.floor(index / parallelRows),
        y: index % parallelRows,
      };
    });
    columns += Math.ceil(layer.length / parallelRows);
    rows = Math.max(rows, Math.min(parallelRows, layer.length));
  }
  return { positions, columns, rows };
}
