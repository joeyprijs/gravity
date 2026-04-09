/**
* Creates a new DOM element.
* @param {string} tag - The HTML tag name.
* @param {string|string[]} [className] - Optional CSS class names.
* @param {string} [innerHTML] - Optional inner HTML content.
* @returns {HTMLElement} The constructed DOM element.
*/
export function createElement(tag, className = "", innerHTML = "") {
  const el = document.createElement(tag);
  if (className) {
    if (Array.isArray(className)) {
      el.classList.add(...className.filter(Boolean));
    } else {
      el.className = className;
    }
  }
  if (innerHTML) {
    el.innerHTML = innerHTML;
  }
  return el;
}

/**
* Clears all child elements from a parent DOM element.
* @param {HTMLElement|string} elementOrId - The element or its ID.
*/
export function clearElement(elementOrId) {
  const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (el) {
    el.innerHTML = '';
  }
}
