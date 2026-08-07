import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DocumentRawContent } from "@/components/results/DocumentRawContent";

describe("DocumentRawContent", () => {
  describe("format: text (invoice/receipt/identity_document's flat OCR text)", () => {
    it("renders the given content, preserving line breaks", () => {
      const { container } = render(<DocumentRawContent content={"Line one\nLine two"} format="text" />);
      expect(container.textContent).toBe("Line one\nLine two");
      expect(container.querySelector(".whitespace-pre-wrap")).not.toBeNull();
    });

    it("uses a monospace font and shows table-like syntax as literal characters, not a rendered table", () => {
      const { container } = render(
        <DocumentRawContent content={"| A | B |\n| --- | --- |\n| 1 | 2 |"} format="text" />,
      );
      expect(container.querySelector(".font-mono")).not.toBeNull();
      expect(container.querySelector("table")).toBeNull();
    });
  });

  describe("format: markdown (generic document's Azure Markdown content)", () => {
    it("renders a GFM pipe table as a real <table>, not literal | characters", () => {
      const { container, getByText } = render(
        <DocumentRawContent content={"| A | B |\n| --- | --- |\n| 1 | 2 |"} format="markdown" />,
      );
      expect(container.querySelector("table")).not.toBeNull();
      expect(getByText("A")).toBeInTheDocument();
      expect(getByText("1")).toBeInTheDocument();
    });

    it("renders a heading element from # syntax", () => {
      const { container } = render(<DocumentRawContent content={"# Invoice Summary"} format="markdown" />);
      const heading = container.querySelector("h1");
      expect(heading).not.toBeNull();
      expect(heading?.textContent).toBe("Invoice Summary");
    });

    it("does not apply the monospace/preformatted text styling used for plain text", () => {
      const { container } = render(<DocumentRawContent content={"Some markdown text."} format="markdown" />);
      expect(container.querySelector(".font-mono")).toBeNull();
      expect(container.querySelector(".whitespace-pre-wrap")).toBeNull();
    });

    it("never renders raw HTML embedded in the source as live elements", () => {
      const { container } = render(
        <DocumentRawContent content={'Some text <img src="x" onerror="alert(1)"> more text'} format="markdown" />,
      );
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("script")).toBeNull();
    });
  });

  it("renders nothing when content is null, regardless of format", () => {
    const asText = render(<DocumentRawContent content={null} format="text" />);
    expect(asText.container).toBeEmptyDOMElement();

    const asMarkdown = render(<DocumentRawContent content={null} format="markdown" />);
    expect(asMarkdown.container).toBeEmptyDOMElement();
  });
});
