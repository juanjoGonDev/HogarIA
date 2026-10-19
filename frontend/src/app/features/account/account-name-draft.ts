/** True when the editable and saved names differ after trimming both values for comparison. */
export function nameDraftIsDirty(draft: string, savedName: string): boolean {
  return draft.trim() !== savedName.trim();
}
