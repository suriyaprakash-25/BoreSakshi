export function safeAuthState(payload) {
  const operator = payload?.operator;
  if (!operator || typeof operator !== "object") return null;
  return {
    operator: {
      id: operator.id,
      name: operator.name,
      phone: operator.phone,
      role: operator.role || "operator",
      status: operator.status || "active",
      verified: operator.verified === true,
    },
  };
}

export function roleHome(operator) {
  return operator?.role === "admin" ? "/admin" : "/dashboard";
}
