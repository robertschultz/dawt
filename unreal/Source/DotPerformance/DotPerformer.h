#pragma once

#include "CoreMinimal.h"
#include "DotBehavior.h"
#include "GameFramework/Actor.h"
#include "DotPerformer.generated.h"

class USceneComponent;
class UStaticMeshComponent;

struct FDotMusicFrame
{
    double Beat = 0;
    float Bpm = 120, Bass = 0, Energy = 0, Fader = 0, Progress = 0;
    int32 Deck = 0, Incoming = 1;
    bool bPlaying = false, bMixing = false, bScheduled = false;
    FString Gesture;
};

enum class EDotTalkPhase : uint8 { Idle, Listening, Hearing, Speaking, Working };
enum class EDotMood : uint8 { Neutral, Warm, Curious, Excited, Concerned };

struct FDotTalkFrame
{
    EDotTalkPhase Phase = EDotTalkPhase::Idle;
    EDotMood Mood = EDotMood::Neutral;
    float Level = 0;
};

UENUM(BlueprintType)
enum class EDotMove : uint8
{
    Show, Bounce, Glide, Spin, Dance
};

UCLASS(Blueprintable)
class DOTPERFORMANCE_API ADotPerformer : public AActor
{
    GENERATED_BODY()

public:
    ADotPerformer();
    virtual void Tick(float DeltaSeconds) override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;

    UFUNCTION(BlueprintCallable, Category="Dot")
    void Cue(EDotMove Move);

    UFUNCTION(BlueprintCallable, Category="Dot")
    void SetPaused(bool bNextPaused);

    UFUNCTION(BlueprintCallable, Category="Dot")
    void SetHeadphonesVisible(bool bVisible);

    UFUNCTION(BlueprintCallable, Category="Dot")
    void MoveAcrossStage(float Direction, float DeltaSeconds);

    UFUNCTION(BlueprintPure, Category="Dot")
    bool IsPaused() const { return bPaused; }

    UFUNCTION(BlueprintPure, Category="Dot")
    bool HasHeadphones() const;

    UFUNCTION(BlueprintPure, Category="Dot")
    EDotMove GetMove() const { return ActiveMove; }

    bool HasMeshes() const;
    FVector CameraSubjectLocation() const;
    bool IsInDanceAccent() const { return bDanceAccent; }
    void SetCrateEngaged(bool bEngaged) { bCrateEngaged=bEngaged; }
    void LearnMove(const FString& MoveName, int32 Direction) { Behavior.Learn(MoveName,Direction); }
    void SetTalkFrame(const FDotTalkFrame& Frame);
    void SetMusicFrame(const FDotMusicFrame& Frame, bool bNewGesture);
    void LeaveMusicMode();

protected:
    virtual void BeginPlay() override;

private:
    UPROPERTY(VisibleAnywhere, Category="Dot")
    TObjectPtr<USceneComponent> Anchor;

    UPROPERTY(VisibleAnywhere, Category="Dot")
    TObjectPtr<USceneComponent> PosePivot;

    UPROPERTY(VisibleAnywhere, Category="Dot")
    TObjectPtr<UStaticMeshComponent> Body;

    UPROPERTY(VisibleAnywhere, Category="Dot")
    TObjectPtr<UStaticMeshComponent> Headphones;

    UPROPERTY(EditAnywhere, Category="Dot")
    EDotMove InitialMove = EDotMove::Show;

    UPROPERTY(EditAnywhere, Category="Dot")
    bool bPlayOnStart = true;

    UPROPERTY(EditAnywhere, Category="Dot")
    bool bWearHeadphonesOnStart = true;

    EDotMove ActiveMove = EDotMove::Show;
    float Time = 0;
    float ManualTravel = 0;
    bool bPaused = false;
    bool bMusicMode = false;
    FDotMusicFrame Music;
    double MusicSampleAt = 0, MusicTickAt = 0;
    float MusicEnergy = 0, TaskLean = 0;
    float GestureAge = 8;
    FString Gesture;
    FDotTalkFrame Talk;
    float TalkAge = 1, TalkBlend = 0, VoiceLevel = 0, AttentionHold = 0;
    FDotBehavior Behavior;
    bool bCrateEngaged = false, bDanceAccent = false;
};
