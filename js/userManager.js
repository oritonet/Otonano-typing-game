// js/userManager.js
const USERS_KEY = "typing_users";
const LAST_KEY = "typing_last_user";

export class UserManager {
  constructor(selectEl) {
    this.selectEl = selectEl;
    this.users = JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
    this.current = localStorage.getItem(LAST_KEY) || this.users[0] || "";
    this.render();
  }

  add(name) {
    if (!name) return;
    if (!this.users.includes(name)) {
      this.users.unshift(name);
      this.users = this.users.slice(0, 10);
      this.save();
    }
    this.select(name);
  }

  select(name) {
    this.current = name;
    localStorage.setItem(LAST_KEY, name);
    this.render();
  }

  save() {
    localStorage.setItem(USERS_KEY, JSON.stringify(this.users));
  }

  render() {
    this.selectEl.innerHTML = "";
    this.users.forEach(u => {
      const o = document.createElement("option");
      o.value = u;
      o.textContent = u;
      if (u === this.current) o.selected = true;
      this.selectEl.appendChild(o);
    });
  }
}
