import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  AccessibilityInfo,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "../theme/colors";
import { speechService } from "../services/speech";
import { hapticsService } from "../services/haptics";
import { readingPipeline, ReadingPipelineResult } from "../services/readingPipeline";
import { TimetableEntry } from "../utils/dateTimeReasoning";
import { ReadingMode } from "./CampusReaderScreen";
import { readCampusText } from "../api/client";
import { LocalizationResult } from "../navigation/localization";

export interface ResultsScreenVoiceActions {
  onReadFullText: () => Promise<void>;
  onSummarize: () => Promise<void>;
  onScanAgain: () => void;
}

export interface ReadingResultsScreenProps {
  result: ReadingPipelineResult;
  mode: ReadingMode;
  imageUri?: string;
  onNavigateHome: () => void;
  onScanAnother: () => void;
  onSetLocation?: (locationName: string) => LocalizationResult | void;
  onViewTimetable?: () => void;
  onRegisterResultsActions?: (actions: ResultsScreenVoiceActions | null) => void;
}

export const ReadingResultsScreen: React.FC<ReadingResultsScreenProps> = ({
  result,
  mode,
  imageUri,
  onNavigateHome,
  onScanAnother,
  onSetLocation,
  onViewTimetable,
  onRegisterResultsActions,
}) => {
  const [currentResult, setCurrentResult] = useState<ReadingPipelineResult>(result);
  const [isEditingText, setIsEditingText] = useState<boolean>(false);
  const [editableText, setEditableText] = useState<string>(
    result.response.source_text || result.response.spoken_summary
  );
  const [isReanalyzing, setIsReanalyzing] = useState<boolean>(false);
  const [isTimetableSaved, setIsTimetableSaved] = useState<boolean>(false);
  const [isSettingLocation, setIsSettingLocation] = useState<boolean>(false);
  const hasAnnouncedWarningRef = useRef<boolean>(false);

  const resp = currentResult.response;
  const isLowConfidence = Boolean(resp.needs_rescan || resp.confidence < 0.65);
  const hasUncertainties = Boolean(resp.uncertainties && resp.uncertainties.length > 0);
  const hasUncheckedAreas = Boolean(resp.unchecked_areas && resp.unchecked_areas.length > 0);

  // Announce scan results and voice navigation options on initial view
  useEffect(() => {
    if (!hasAnnouncedWarningRef.current) {
      hasAnnouncedWarningRef.current = true;
      let spokenOutput = currentResult.spokenText;
      if (isLowConfidence) {
        spokenOutput = `Warning: low confidence scan. ${spokenOutput}. Re-scan recommended.`;
      }
      spokenOutput += " You can say 'read the full text', 'summarize this', 'scan again', or 'go home'.";
      speechService.speak(spokenOutput, { force: true });
    }
  }, []);

  const handleReadFullText = async () => {
    await hapticsService.triggerButtonPress();
    const full =
      currentResult.response.source_text?.trim() ||
      currentResult.response.spoken_summary?.trim();
    if (!full) {
      await speechService.speak(
        "No verbatim source text was detected in this scan. Say 'summarize this' or 'scan again'.",
        { force: true }
      );
      return;
    }
    await speechService.speak(`Full text: ${full}`, { force: true });
  };

  const handleSummarizeThis = async () => {
    await hapticsService.triggerButtonPress();
    const summary = currentResult.response.spoken_summary?.trim();
    if (!summary) {
      await speechService.speak(
        "No summary was extracted for this scan. Say 'read the full text' or 'scan again'.",
        { force: true }
      );
      return;
    }
    await speechService.speak(`Summary: ${summary}`, { force: true });
  };

  // Register real action handlers for global voice dispatcher
  useEffect(() => {
    if (onRegisterResultsActions) {
      onRegisterResultsActions({
        onReadFullText: handleReadFullText,
        onSummarize: handleSummarizeThis,
        onScanAgain: onScanAnother,
      });
    }
    return () => {
      onRegisterResultsActions?.(null);
    };
  }, [onRegisterResultsActions, currentResult, onScanAnother]);

  const handleReadAloud = async () => {
    await hapticsService.triggerButtonPress();
    let spokenOutput = currentResult.spokenText;
    if (isLowConfidence) {
      spokenOutput = `Warning: low confidence scan. ${spokenOutput}. Re-scan recommended.`;
    }
    if (hasUncertainties && resp.uncertainties.length > 0) {
      spokenOutput += ` Safety notice: ${resp.uncertainties.join(". ")}.`;
    }
    if (hasUncheckedAreas && resp.unchecked_areas.length > 0) {
      spokenOutput += ` Areas not checked by camera: ${resp.unchecked_areas.join(". ")}.`;
    }
    await speechService.speak(spokenOutput, { force: true });
  };

  const handleStop = async () => {
    await hapticsService.triggerBottomLeft();
    await speechService.stop();
  };

  const handleRepeat = async () => {
    await hapticsService.triggerBottomLeft();
    await speechService.repeatLast();
  };

  // Explicit confirmation to save extracted timetable entries into personal schedule
  const handleConfirmTimetable = async () => {
    if (!currentResult.extractedTimetableEntries || currentResult.extractedTimetableEntries.length === 0) {
      return;
    }
    if (isLowConfidence) {
      await hapticsService.triggerError();
      await speechService.speak(
        "Cannot save uncertain timetable entries. Please re-scan your syllabus with clear lighting and steady focus.",
        { force: true }
      );
      return;
    }
    try {
      await hapticsService.triggerSuccess();
      await readingPipeline.saveTimetable(currentResult.extractedTimetableEntries);
      setIsTimetableSaved(true);
      const confirmationMsg = `Successfully confirmed and saved ${currentResult.extractedTimetableEntries.length} classes to your personal timetable.`;
      await speechService.speak(confirmationMsg, { force: true });
    } catch {
      await speechService.speak("Failed to save timetable entries. Please try again.", { force: true });
    }
  };

  // Re-run backend extraction with corrected OCR text
  const handleSaveTextCorrection = async () => {
    try {
      setIsReanalyzing(true);
      await speechService.speak("Re-analyzing corrected text with Gemma 4...", { force: true });

      const newResponse = await readCampusText({
        ocrText: editableText,
        readingMode: mode,
      });

      let newEntries: TimetableEntry[] | undefined = undefined;
      if (newResponse.timetable_items && newResponse.timetable_items.length > 0) {
        newEntries = readingPipeline.convertExtractedItemsToEntries(newResponse.timetable_items);
      }

      const updated: ReadingPipelineResult = {
        spokenText: newResponse.spoken_summary,
        response: newResponse,
        extractedTimetableEntries: newEntries,
      };

      setCurrentResult(updated);
      setIsEditingText(false);
      setIsReanalyzing(false);
      await speechService.speak(newResponse.spoken_summary, { force: true });
    } catch (err: any) {
      setIsReanalyzing(false);
      const errText = err?.message || "Failed to re-analyze text.";
      await speechService.speak(errText, { force: true });
    }
  };

  const handleSetCurrentLocation = async (locName: string) => {
    if (isLowConfidence) {
      await hapticsService.triggerError();
      await speechService.speak(
        "Cannot set navigation starting point from an uncertain room scan. Please re-scan the door sign.",
        { force: true }
      );
      return;
    }

    const locResult = onSetLocation?.(locName);
    if (locResult && !locResult.isLocalized) {
      setIsSettingLocation(false);
      await hapticsService.triggerError();
      await speechService.speak(locResult.spokenMessage, { force: true });
      return;
    }

    setIsSettingLocation(true);
    await hapticsService.triggerSuccess();
    const spoken = locResult?.spokenMessage || `Starting landmark set to ${locName}.`;
    await speechService.speak(spoken, { force: true });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* 1. Header with Mode and Confidence */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={onNavigateHome}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          <Text style={styles.backButtonText}>Home</Text>
        </Pressable>

        <View style={styles.headerBadgesRow}>
          <View style={styles.modeBadge}>
            <Text style={styles.modeBadgeText}>{mode.toUpperCase()}</Text>
          </View>
          <View
            style={[
              styles.confidenceBadge,
              resp.confidence >= 0.75
                ? styles.confidenceHigh
                : resp.confidence >= 0.5
                ? styles.confidenceMed
                : styles.confidenceLow,
            ]}
          >
            <Text style={styles.confidenceBadgeText}>
              {Math.round(resp.confidence * 100)}% Match
            </Text>
          </View>
        </View>
      </View>

      {/* Prominent Rescan Warning Banner if confidence is below safety threshold */}
      {isLowConfidence && (
        <View style={styles.rescanWarningBanner} accessible={true} accessibilityRole="alert">
          <View style={styles.rescanWarningHeader}>
            <Ionicons name="warning" size={24} color={Colors.error} />
            <Text style={styles.rescanWarningTitle}>Low Confidence Scan</Text>
          </View>
          <Text style={styles.rescanWarningBody}>
            The scan clarity is low ({Math.round(resp.confidence * 100)}% match). Information may be incomplete or misread. For safety, re-scan with steadier camera or clearer lighting before saving or navigating.
          </Text>
          <Pressable
            onPress={onScanAnother}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Re-scan campus document with clearer lighting or steadier camera"
            style={styles.rescanActionButton}
          >
            <Ionicons name="refresh" size={18} color="#FFFFFF" />
            <Text style={styles.rescanActionButtonText}>Scan Again</Text>
          </Pressable>
        </View>
      )}

      {/* 2. Spoken Summary Card */}
      <View style={styles.summaryCard} accessible={true} accessibilityRole="summary">
        <View style={styles.summaryHeaderRow}>
          <Ionicons name="volume-high" size={24} color={Colors.primary} />
          <Text style={styles.summaryTitle}>Spoken Description</Text>
        </View>
        <Text style={styles.summaryText}>{currentResult.spokenText}</Text>

        <View style={styles.speechActionButtonsRow}>
          <Pressable
            onPress={handleReadAloud}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Read description aloud"
            style={styles.speechButtonPrimary}
          >
            <Ionicons name="play" size={18} color="#FFFFFF" />
            <Text style={styles.speechButtonPrimaryText}>Read Aloud</Text>
          </Pressable>

          <Pressable
            onPress={handleStop}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Stop speech"
            style={styles.speechButtonStop}
          >
            <Ionicons name="stop" size={18} color="#FFFFFF" />
            <Text style={styles.speechButtonStopText}>Stop</Text>
          </Pressable>

          <Pressable
            onPress={handleRepeat}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Repeat speech"
            style={styles.speechButtonSecondary}
          >
            <Ionicons name="refresh" size={18} color={Colors.textPrimary} />
            <Text style={styles.speechButtonSecondaryText}>Repeat</Text>
          </Pressable>
        </View>
      </View>

      {/* 3. STRUCTURED DATA: TIMETABLE CONFIRMATION (Part D) */}
      {currentResult.extractedTimetableEntries &&
        currentResult.extractedTimetableEntries.length > 0 && (
          <View style={styles.structuredSection} accessible={true}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="calendar" size={22} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Proposed Class Schedule</Text>
            </View>
            <Text style={styles.sectionSubtitle}>
              Please verify extracted classes before saving into your personal timetable:
            </Text>

            {currentResult.extractedTimetableEntries.map((cls, idx) => (
              <View key={cls.id || idx} style={styles.classCard} accessible={true}>
                <View style={styles.classCardHeader}>
                  <Text style={styles.classCourseCode}>{cls.courseCode}</Text>
                  <Text style={styles.classTime}>
                    {cls.startTime} - {cls.endTime}
                  </Text>
                </View>
                <Text style={styles.classCourseName}>{cls.courseName}</Text>
                <Text style={styles.classLocation}>
                  📍 Room {cls.room} {cls.building ? `(${cls.building})` : ""}
                </Text>
              </View>
            ))}

            {isTimetableSaved ? (
              <View style={styles.savedSuccessCard}>
                <Ionicons name="checkmark-circle" size={24} color={Colors.success} />
                <Text style={styles.savedSuccessText}>Classes saved to your schedule!</Text>
                {onViewTimetable && (
                  <Pressable
                    onPress={onViewTimetable}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="View full timetable"
                    style={styles.viewTimetableButton}
                  >
                    <Text style={styles.viewTimetableButtonText}>View Timetable</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View>
                <Pressable
                  onPress={handleConfirmTimetable}
                  disabled={isLowConfidence}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isLowConfidence
                      ? "Cannot save classes: scan confidence is low. Re-scan syllabus to confirm."
                      : `Confirm and save ${currentResult.extractedTimetableEntries.length} classes to personal timetable`
                  }
                  style={[
                    styles.confirmSaveButton,
                    isLowConfidence && styles.confirmSaveButtonDisabled,
                  ]}
                >
                  <Ionicons
                    name={isLowConfidence ? "alert-circle-outline" : "save-outline"}
                    size={20}
                    color="#FFFFFF"
                  />
                  <Text style={styles.confirmSaveButtonText}>
                    {isLowConfidence
                      ? "Re-scan Needed to Confirm Classes"
                      : `Confirm & Save Classes (${currentResult.extractedTimetableEntries.length})`}
                  </Text>
                </Pressable>
                {isLowConfidence && (
                  <Text style={styles.lowConfidenceHint}>
                    Safety lock: Verify schedule with a clear scan before saving.
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

      {/* 4. STRUCTURED DATA: DOOR SIGN LOCALIZATION */}
      {resp.door_sign && (
        <View style={styles.structuredSection} accessible={true}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="business" size={22} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Room Sign Information</Text>
          </View>

          <View style={styles.signCard}>
            <Text style={styles.signRoomNumber}>{resp.door_sign.room_number}</Text>
            {resp.door_sign.department && (
              <Text style={styles.signDepartment}>{resp.door_sign.department}</Text>
            )}
            {resp.door_sign.occupants && resp.door_sign.occupants.length > 0 && (
              <View style={styles.signOccupantsWrap}>
                <Text style={styles.signOccupantsLabel}>Occupants:</Text>
                {resp.door_sign.occupants.map((occ, i) => (
                  <Text key={i} style={styles.signOccupantName}>
                    • {occ}
                  </Text>
                ))}
              </View>
            )}

            <View>
              <Pressable
                onPress={() => handleSetCurrentLocation(resp.door_sign!.room_number)}
                disabled={isLowConfidence}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={
                  isLowConfidence
                    ? "Cannot set starting location from an uncertain room scan. Please re-scan."
                    : `Set ${resp.door_sign.room_number} as current starting location for campus navigation`
                }
                style={[
                  styles.setLocationButton,
                  isLowConfidence && styles.setLocationButtonDisabled,
                ]}
              >
                <Ionicons
                  name={
                    isSettingLocation
                      ? "checkmark-circle"
                      : isLowConfidence
                      ? "alert-circle-outline"
                      : "locate"
                  }
                  size={20}
                  color="#FFFFFF"
                />
                <Text style={styles.setLocationButtonText}>
                  {isLowConfidence
                    ? "Re-scan Needed to Set Location"
                    : isSettingLocation
                    ? "Location Set!"
                    : "Set as Navigation Starting Point"}
                </Text>
              </Pressable>
              {isLowConfidence && (
                <Text style={styles.lowConfidenceHint}>
                  Safety lock: Door sign must be clearly verified before setting navigation origin.
                </Text>
              )}
            </View>
          </View>
        </View>
      )}

      {/* 5. STRUCTURED DATA: NOTICES & DEADLINES */}
      {resp.notices && resp.notices.length > 0 && (
        <View style={styles.structuredSection} accessible={true}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="newspaper-outline" size={22} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Campus Announcements</Text>
          </View>

          {resp.notices.map((notice, idx) => (
            <View key={idx} style={styles.noticeCard}>
              <View style={styles.noticeHeaderRow}>
                <Text style={styles.noticeTitle}>{notice.title}</Text>
                <View
                  style={[
                    styles.urgencyBadge,
                    notice.urgency === "high" ? styles.urgencyHigh : styles.urgencyNormal,
                  ]}
                >
                  <Text style={styles.urgencyBadgeText}>{notice.urgency.toUpperCase()}</Text>
                </View>
              </View>
              {notice.raw_date_text && (
                <Text style={styles.noticeDate}>📅 {notice.raw_date_text}</Text>
              )}
              <Text style={styles.noticeSummary}>{notice.summary}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 6. SAFETY DISCLOSURES & UNCHECKED AREAS (Rule 5: Never claim path is clear) */}
      {(hasUncheckedAreas || hasUncertainties) && (
        <View style={styles.safetyDisclosuresCard} accessible={true} accessibilityRole="summary">
          <View style={styles.safetyHeaderRow}>
            <Ionicons name="shield-checkmark-outline" size={22} color={Colors.warning} />
            <Text style={styles.safetyTitle}>Safety Disclosures & Limitations</Text>
          </View>
          <Text style={styles.safetySubtitle}>
            Verified camera observations only. Never assume uninspected areas are clear of hazards.
          </Text>

          {hasUncheckedAreas && (
            <View style={styles.disclosureBlock}>
              <Text style={styles.disclosureHeading}>Areas Not Checked by Camera:</Text>
              {resp.unchecked_areas.map((area, idx) => (
                <View key={idx} style={styles.disclosureItemRow}>
                  <Text style={styles.disclosureBullet}>•</Text>
                  <Text style={styles.disclosureText}>{area}</Text>
                </View>
              ))}
            </View>
          )}

          {hasUncertainties && (
            <View style={styles.disclosureBlock}>
              <Text style={styles.disclosureHeading}>Uncertainties & Warnings:</Text>
              {resp.uncertainties.map((unc, idx) => (
                <View key={idx} style={styles.disclosureItemRow}>
                  <Text style={styles.disclosureBullet}>⚠️</Text>
                  <Text style={styles.disclosureText}>{unc}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* 7. RAW RECOGNIZED OCR TEXT & CORRECTION */}
      <View style={styles.rawTextSection}>
        <View style={styles.rawTextHeaderRow}>
          <Text style={styles.rawTextTitle}>Recognized Source Text</Text>
          <Pressable
            onPress={() => {
              setEditableText(resp.source_text || currentResult.spokenText);
              setIsEditingText(true);
            }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Edit or correct recognized text"
            style={styles.editTextButton}
          >
            <Ionicons name="pencil" size={16} color={Colors.primary} />
            <Text style={styles.editTextButtonText}>Edit Text</Text>
          </Pressable>
        </View>

        <View style={styles.rawTextContainer}>
          <Text style={styles.rawTextContent} selectable={true}>
            {resp.source_text || "(No raw text returned)"}
          </Text>
        </View>
      </View>

      {/* 7. Action Footer */}
      <View style={styles.footerActions}>
        <Pressable
          onPress={onScanAnother}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Scan another campus image"
          style={styles.scanAnotherButton}
        >
          <Ionicons name="camera-outline" size={20} color="#FFFFFF" />
          <Text style={styles.scanAnotherButtonText}>Scan Another</Text>
        </Pressable>

        <Pressable
          onPress={onNavigateHome}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Return to home screen"
          style={styles.homeReturnButton}
        >
          <Ionicons name="home-outline" size={20} color={Colors.textPrimary} />
          <Text style={styles.homeReturnButtonText}>Back to Home</Text>
        </Pressable>
      </View>

      {/* 8. EDIT TEXT MODAL */}
      <Modal
        visible={isEditingText}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsEditingText(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Correct Recognized Text</Text>
              <Pressable
                onPress={() => setIsEditingText(false)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Close text editor"
              >
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <Text style={styles.modalHint}>
              Fix any OCR typos or misread classroom letters, then re-analyze with Gemma 4:
            </Text>

            <TextInput
              style={styles.modalTextInput}
              multiline={true}
              numberOfLines={6}
              value={editableText}
              onChangeText={setEditableText}
              accessible={true}
              accessibilityLabel="Edit recognized OCR text"
            />

            <View style={styles.modalButtonsRow}>
              <Pressable
                onPress={() => setIsEditingText(false)}
                style={styles.modalCancelButton}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Cancel editing"
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleSaveTextCorrection}
                disabled={isReanalyzing}
                style={styles.modalSubmitButton}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Submit corrected text for re-analysis"
              >
                {isReanalyzing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitButtonText}>Re-analyze with Gemma</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  contentContainer: {
    padding: 20,
    paddingTop: 48,
    paddingBottom: 60,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  headerBadgesRow: {
    flexDirection: "row",
    gap: 8,
  },
  modeBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modeBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.primary,
  },
  confidenceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  confidenceHigh: {
    backgroundColor: Colors.successBackground,
  },
  confidenceMed: {
    backgroundColor: Colors.warningBackground,
  },
  confidenceLow: {
    backgroundColor: Colors.errorBackground,
  },
  confidenceBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: Colors.textPrimary,
  },
  summaryText: {
    fontSize: 16,
    color: Colors.textPrimary,
    lineHeight: 24,
    marginBottom: 18,
  },
  speechActionButtonsRow: {
    flexDirection: "row",
    gap: 8,
  },
  speechButtonPrimary: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 48,
  },
  speechButtonPrimaryText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  speechButtonStop: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.stopButton,
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 48,
  },
  speechButtonStopText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  speechButtonSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 48,
  },
  speechButtonSecondaryText: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  structuredSection: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: Colors.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 14,
    lineHeight: 18,
  },
  classCard: {
    backgroundColor: Colors.backgroundAlt,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  classCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  classCourseCode: {
    fontSize: 15,
    fontWeight: "900",
    color: Colors.primary,
  },
  classTime: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  classCourseName: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  classLocation: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  confirmSaveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
    minHeight: 52,
  },
  confirmSaveButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  savedSuccessCard: {
    alignItems: "center",
    padding: 16,
    backgroundColor: Colors.successBackground,
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.success,
  },
  savedSuccessText: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.success,
    marginTop: 6,
    marginBottom: 10,
  },
  viewTimetableButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  viewTimetableButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  signCard: {
    backgroundColor: Colors.backgroundAlt,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  signRoomNumber: {
    fontSize: 22,
    fontWeight: "900",
    color: Colors.primary,
    marginBottom: 4,
  },
  signDepartment: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 10,
  },
  signOccupantsWrap: {
    marginBottom: 14,
  },
  signOccupantsLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.textMuted,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  signOccupantName: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  setLocationButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 48,
  },
  setLocationButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  noticeCard: {
    backgroundColor: Colors.backgroundAlt,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noticeHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  noticeTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  urgencyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  urgencyHigh: {
    backgroundColor: Colors.errorBackground,
  },
  urgencyNormal: {
    backgroundColor: Colors.primaryLight,
  },
  urgencyBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  noticeDate: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.primary,
    marginBottom: 6,
  },
  noticeSummary: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  rawTextSection: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  rawTextHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  rawTextTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textMuted,
    textTransform: "uppercase",
  },
  editTextButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: Colors.primaryLight,
  },
  editTextButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primary,
  },
  rawTextContainer: {
    backgroundColor: Colors.backgroundAlt,
    borderRadius: 10,
    padding: 12,
    maxHeight: 180,
  },
  rawTextContent: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18,
  },
  footerActions: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  scanAnotherButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 52,
  },
  scanAnotherButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  homeReturnButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 52,
  },
  homeReturnButtonText: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.7)",
    justifyContent: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    maxHeight: "80%",
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: Colors.textPrimary,
  },
  modalHint: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  modalTextInput: {
    backgroundColor: Colors.backgroundAlt,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.textPrimary,
    minHeight: 120,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  modalButtonsRow: {
    flexDirection: "row",
    gap: 10,
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: Colors.backgroundAlt,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  modalCancelButtonText: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  modalSubmitButton: {
    flex: 2,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  modalSubmitButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  rescanWarningBanner: {
    backgroundColor: "#FEF2F2",
    borderWidth: 2,
    borderColor: Colors.error,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  rescanWarningHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  rescanWarningTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: Colors.error,
    marginLeft: 8,
  },
  rescanWarningBody: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  rescanActionButton: {
    backgroundColor: Colors.error,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 48,
  },
  rescanActionButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginLeft: 6,
  },
  safetyDisclosuresCard: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  safetyHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  safetyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
    marginLeft: 8,
  },
  safetySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  disclosureBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  disclosureHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  disclosureItemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  disclosureBullet: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginRight: 6,
    lineHeight: 20,
  },
  disclosureText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  confirmSaveButtonDisabled: {
    backgroundColor: "#94A3B8",
    opacity: 0.8,
  },
  setLocationButtonDisabled: {
    backgroundColor: "#94A3B8",
    opacity: 0.8,
  },
  lowConfidenceHint: {
    fontSize: 12,
    color: Colors.error,
    fontWeight: "600",
    marginTop: 6,
    textAlign: "center",
  },
});
