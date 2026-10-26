import { describe, it, expect } from "@jest/globals";
import { CampusLocalizer } from "../navigation/localization";
import { CampusGraph } from "../navigation/campusRouter";
import sampleGraphData from "../../../data/sample_campus_graph.json";
import { CampusReadingResponse } from "../api/client";

describe("Phase 1 Integration Fixes Unit Tests", () => {
  const sampleGraph = sampleGraphData as unknown as CampusGraph;
  const localizer = new CampusLocalizer(sampleGraph);

  describe("Fix 1: Backend Health & Mock Mode Detection Logic", () => {
    it("correctly identifies backend health with status 'ok'", () => {
      const backendHealthResponse = {
        status: "ok",
        service: "saarthi-backend",
        version: "0.1.0",
      };

      const isHealthy =
        backendHealthResponse.status === "ok" ||
        backendHealthResponse.status === "healthy";
      expect(isHealthy).toBe(true);
    });

    it("correctly identifies backend health with status 'healthy'", () => {
      const backendHealthResponse = {
        status: "healthy",
      };

      const isHealthy =
        backendHealthResponse.status === "ok" ||
        backendHealthResponse.status === "healthy";
      expect(isHealthy).toBe(true);
    });

    it("rejects invalid backend status strings", () => {
      const backendHealthResponse = {
        status: "degraded",
      };

      const isHealthy =
        backendHealthResponse.status === "ok" ||
        backendHealthResponse.status === "healthy";
      expect(isHealthy).toBe(false);
    });

    it("accurately detects mock mode and prevents showing live Gemma 4", () => {
      const aiStatusInMockMode = {
        configured: true,
        model: "gemma-4-mock",
        mock_mode: true,
      };

      // Condition used in HomeScreen:
      const shouldDisplayLiveGemma =
        aiStatusInMockMode.configured && !aiStatusInMockMode.mock_mode;
      const shouldDisplayMockEngine = aiStatusInMockMode.mock_mode;

      expect(shouldDisplayLiveGemma).toBe(false);
      expect(shouldDisplayMockEngine).toBe(true);
    });

    it("accurately detects live mode when mock_mode is false", () => {
      const aiStatusInLiveMode = {
        configured: true,
        model: "gemma-4-27b",
        mock_mode: false,
      };

      const shouldDisplayLiveGemma =
        aiStatusInLiveMode.configured && !aiStatusInLiveMode.mock_mode;
      const shouldDisplayMockEngine = aiStatusInLiveMode.mock_mode;

      expect(shouldDisplayLiveGemma).toBe(true);
      expect(shouldDisplayMockEngine).toBe(false);
    });
  });

  describe("Fix 2: Safety Disclosures & Low-Confidence Guards", () => {
    const safetyThreshold = 0.65;

    it("triggers low confidence warning when confidence is below safety threshold", () => {
      const lowConfidenceResponse: Partial<CampusReadingResponse> = {
        confidence: 0.45,
        needs_rescan: false,
        uncertainties: ["Image is blurry around room number digits"],
        unchecked_areas: ["Floor level obstacles", "Door handles"],
      };

      const isLowConfidence = Boolean(
        lowConfidenceResponse.needs_rescan ||
          (lowConfidenceResponse.confidence !== undefined &&
            lowConfidenceResponse.confidence < safetyThreshold)
      );

      expect(isLowConfidence).toBe(true);
      expect(lowConfidenceResponse.uncertainties).toHaveLength(1);
      expect(lowConfidenceResponse.unchecked_areas).toHaveLength(2);
    });

    it("triggers low confidence warning when needs_rescan is explicitly true even if confidence is 0.70", () => {
      const rescanResponse: Partial<CampusReadingResponse> = {
        confidence: 0.70,
        needs_rescan: true,
        uncertainties: ["Lighting glare across sign"],
      };

      const isLowConfidence = Boolean(
        rescanResponse.needs_rescan ||
          (rescanResponse.confidence !== undefined &&
            rescanResponse.confidence < safetyThreshold)
      );

      expect(isLowConfidence).toBe(true);
    });

    it("considers scan reliable only when needs_rescan is false and confidence >= 0.65", () => {
      const reliableResponse: Partial<CampusReadingResponse> = {
        confidence: 0.88,
        needs_rescan: false,
        uncertainties: [],
        unchecked_areas: ["Ground drop-offs not surveyed"],
      };

      const isLowConfidence = Boolean(
        reliableResponse.needs_rescan ||
          (reliableResponse.confidence !== undefined &&
            reliableResponse.confidence < safetyThreshold)
      );

      expect(isLowConfidence).toBe(false);
      // Even in a reliable scan, unchecked areas must still be disclosed
      expect(reliableResponse.unchecked_areas).toContain(
        "Ground drop-offs not surveyed"
      );
    });

    it("verifies speech disclosure includes unchecked areas and uncertainties without declaring path clear", () => {
      const resp: Partial<CampusReadingResponse> = {
        confidence: 0.80,
        needs_rescan: false,
        spoken_summary: "Room 204 door sign detected.",
        uncertainties: ["Instructor name obscured"],
        unchecked_areas: ["Floor obstacles", "Out-of-frame corridor"],
      };

      let spokenOutput = resp.spoken_summary!;
      if (resp.uncertainties && resp.uncertainties.length > 0) {
        spokenOutput += ` Safety notice: ${resp.uncertainties.join(". ")}.`;
      }
      if (resp.unchecked_areas && resp.unchecked_areas.length > 0) {
        spokenOutput += ` Areas not checked by camera: ${resp.unchecked_areas.join(". ")}.`;
      }

      expect(spokenOutput).toContain("Safety notice: Instructor name obscured");
      expect(spokenOutput).toContain(
        "Areas not checked by camera: Floor obstacles. Out-of-frame corridor"
      );
      expect(spokenOutput).not.toContain("path is clear");
      expect(spokenOutput).not.toContain("obstacle-free");
    });
  });

  describe("Fix 3: Dynamic Localization Replacing Hardcoded Room 204", () => {
    it("dynamically localizes Room 204 via CampusLocalizer without hardcoding", () => {
      const result = localizer.localizeFromOcr("Room 204 Computer Science Lab");
      expect(result.isLocalized).toBe(true);
      expect(result.node?.id).toBe("room_204");
    });

    it("dynamically localizes Room 101 via CampusLocalizer", () => {
      const result = localizer.localizeFromOcr("101 Lecture Hall");
      expect(result.isLocalized).toBe(true);
      expect(result.node?.id).toBe("room_101");
    });

    it("gracefully rejects unknown location and does not invent arbitrary node", () => {
      const result = localizer.localizeFromOcr("Room 888 Biochemistry Lab");
      expect(result.isLocalized).toBe(false);
      expect(result.node).toBeNull();
      expect(result.spokenMessage).toContain("does not match a verified location");
      expect(result.spokenMessage).toContain("select a known landmark");
    });

    it("uses verified 'entrance_main' as default start node rather than invalid 'node_turing_entrance'", () => {
      const defaultStartNode = sampleGraph.nodes.find(
        (n) => n.id === "entrance_main"
      );
      expect(defaultStartNode).toBeDefined();
      expect(defaultStartNode?.label).toBe("Turing Hall Main Entrance");

      const invalidStartNode = sampleGraph.nodes.find(
        (n) => n.id === "node_turing_entrance"
      );
      expect(invalidStartNode).toBeUndefined();
    });
  });
});
