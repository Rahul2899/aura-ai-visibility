import { domainMatchesBrand } from "../app/lib/brands";

describe("domainMatchesBrand — only trust a logo when the domain fits the brand", () => {
  it("accepts genuine matches", () => {
    expect(domainMatchesBrand("Nike", "nike.com")).toBe(true);
    expect(domainMatchesBrand("Notion", "notion.so")).toBe(true);
    expect(domainMatchesBrand("Notion", "www.notion.so")).toBe(true);
    expect(domainMatchesBrand("Wise", "wise.com")).toBe(true);
    expect(domainMatchesBrand("Coca Cola", "coca-cola.com")).toBe(true);
  });

  it("REJECTS mismatched domains (the bug: wrong logo next to brand)", () => {
    expect(domainMatchesBrand("Apple", "wildcraft.com")).toBe(false);
    expect(domainMatchesBrand("Pepsi", "randomstartup.io")).toBe(false);
    expect(domainMatchesBrand("Tesla", "ford.com")).toBe(false);
  });

  it("rejects empty/missing domains", () => {
    expect(domainMatchesBrand("Nike", null)).toBe(false);
    expect(domainMatchesBrand("Nike", "")).toBe(false);
    expect(domainMatchesBrand("Nike", undefined)).toBe(false);
  });

  it("handles scheme/path/www variations", () => {
    expect(domainMatchesBrand("Stripe", "https://stripe.com/pricing")).toBe(true);
    expect(domainMatchesBrand("GitHub", "https://www.github.com")).toBe(true);
  });
});
