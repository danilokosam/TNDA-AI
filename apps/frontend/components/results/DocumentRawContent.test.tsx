import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DocumentRawContent } from "@/components/results/DocumentRawContent";

describe("DocumentRawContent", () => {
  it("renders the given content, preserving line breaks", () => {
    const { container } = render(<DocumentRawContent content={"Line one\nLine two"} />);
    expect(container.textContent).toBe("Line one\nLine two");
    expect(container.querySelector(".whitespace-pre-wrap")).not.toBeNull();
  });

  it("renders nothing when content is null", () => {
    const { container } = render(<DocumentRawContent content={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
