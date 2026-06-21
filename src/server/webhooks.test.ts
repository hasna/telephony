import { describe, expect, it } from "bun:test";
import { parseFormBody } from "./webhooks.js";

describe("parseFormBody", () => {
  it("decodes application/x-www-form-urlencoded webhook payloads", () => {
    expect(parseFormBody("MessageSid=SM123&Body=hello+world%21&From=%2B15551234567")).toEqual({
      MessageSid: "SM123",
      Body: "hello world!",
      From: "+15551234567",
    });
  });

  it("preserves equals signs inside field values", () => {
    expect(parseFormBody("Body=token=a=b=c&MessageSid=SM123")).toEqual({
      Body: "token=a=b=c",
      MessageSid: "SM123",
    });
  });

  it("decodes plus signs in field names as spaces", () => {
    expect(parseFormBody("Friendly+Name=Main+line")).toEqual({
      "Friendly Name": "Main line",
    });
  });
});
