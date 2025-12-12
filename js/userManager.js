// js/userManager.js
export class UserManager {
  constructor(selectEl) {
    this.selectEl = selectEl;
    this.users = JSON.parse(localStorage.getItem("typing_users") || "[]");
    this.current = localStorage.getItem("typing_current_user") || null;
    this.render();
  }

  render() {
    this.selectEl.innerHTML = "";
    this.users.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u;
      this.selectEl.appendChild(opt);
    });

    if (this.current && this.users.includes(this.current)) {
      this.selectEl.value = this.current;
    }
  }

  addUser(name) {
    if (this.users.length >= 10) return;
    this.users.push(name);
    this.current = name;
    this.save();
  }

  setCurrent(name) {
    this.current = name;
    this.save();
  }

  save() {
    localStorage.setItem("typing_users", JSON.stringify(this.users));
    localStorage.setItem("typing_current_user", this.current);
    this.render();
  }

  getCurrent() {
    return this.current;
  }
}
