interface BackboneProps {
    x1: number;
    x2: number;
    y: number;
}

export const Backbone = ({ x1, x2, y }: BackboneProps) => {
    return (
        <line
            x1={x1}
            y1={y}
            x2={x2}
            y2={y}
            strokeWidth={3}
            strokeLinecap="round"
            style={{
                stroke: "var(--joy-palette-neutral-400)",
                vectorEffect: "non-scaling-stroke"
            }}
        />
    );
};
