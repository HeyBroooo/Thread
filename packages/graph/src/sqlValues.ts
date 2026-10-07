export function buildValuesTuples(rowCount: number, columnsPerRow: number): string[] {
  return Array.from({ length: rowCount }, (_, row) => {
    const firstParameter = row * columnsPerRow + 1;
    const placeholders = Array.from(
      { length: columnsPerRow },
      (_, column) => `$${firstParameter + column}`,
    );
    return `(${placeholders.join(',')})`;
  });
}
