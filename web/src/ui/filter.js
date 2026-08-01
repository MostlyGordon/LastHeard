// Area/text filter bound to the search box.
import { setFilter } from "../store.js";

export function initFilter(input) {
  input.value = localStorage.getItem("lastheard:filter") || "";
  let t = null;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => setFilter(input.value), 120);
  });
}