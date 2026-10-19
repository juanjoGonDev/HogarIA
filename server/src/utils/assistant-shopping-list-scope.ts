/**
 * Global assistant actions use exactly the explicitly selected personal or household scope.
 * Shopping's regular UI may show both; a reviewed assistant action must not fall back across them.
 */
export function assistantShoppingListScope(
  userId: string,
  householdId: string | null
): {
  clause: string;
  params: string[];
  householdId: string | null;
} {
  if (householdId) {
    return { clause: 'household_id = ?', params: [householdId], householdId };
  }
  return {
    clause: '(user_id = ? AND household_id IS NULL)',
    params: [userId],
    householdId: null
  };
}
