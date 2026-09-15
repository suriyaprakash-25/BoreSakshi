const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,128}$/;

export function validateAuthForm({ mode, name = "", phone = "", password = "", confirmPassword = "" }) {
  const signup = mode === "signup";
  if (signup && !String(name).trim()) return "Name is required.";
  if (!String(phone).trim()) return "Phone is required.";
  if (!String(password)) return "Password is required.";
  if (signup && !STRONG_PASSWORD.test(String(password))) {
    return "Password must be 10–128 characters and include uppercase, lowercase, a number and a special character.";
  }
  if (signup && password !== confirmPassword) return "Passwords do not match.";
  return null;
}

export { STRONG_PASSWORD };
