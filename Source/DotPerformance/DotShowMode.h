#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "DotShowMode.generated.h"

class ACameraActor;
class ADirectionalLight;
class APointLight;
class AStaticMeshActor;
class UActorComponent;
class UMaterialInstanceDynamic;
class ADotPerformer;
class FJsonObject;
class FSocket;
class UAudioComponent;
class USoundWaveProcedural;
class UStaticMesh;

UCLASS()
class DOTPERFORMANCE_API ADotShowMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    ADotShowMode();
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
    virtual void Tick(float DeltaSeconds) override;

private:
    UFUNCTION()
    void ReceiveBrowserInput(const FString& Message);

    void SetCommand(const FString& Command);
    void ApplyStage();
    void UpdateCamera(float DeltaSeconds);
    void BuildBooth();
    void SetBoothVenue(int32 Venue);
    void UpdateVenueVisibility();
    void ReadPerformanceCue(const FJsonObject& Data, int32 Deck, int32 Incoming, bool bPlaying, double Now);
    int32 FindShelfSlot(const FString& Track, int32 Crate);
    bool IsSleeveEmpty(int32 Slot) const;
    void QueueRefile(int32 Deck);
    void SetBoothVisible(bool bVisible);
    void SetCrateVisibility(bool bVisible);
    void SetTableVisibility(bool bVisible);
    void UpdateTableVisibility();
    void ReceiveMusic(const FJsonObject& Data);
    void TickBooth(float DeltaSeconds);
    void MaintainBoothClearance(float DeltaSeconds);
    void TickMasterAudio();

    UPROPERTY() TObjectPtr<ADotPerformer> Performer;
    UPROPERTY() TObjectPtr<ACameraActor> Camera;
    UPROPERTY() TObjectPtr<AStaticMeshActor> StageFloor;
    UPROPERTY() TObjectPtr<AStaticMeshActor> StageWall;
    UPROPERTY() TObjectPtr<ADirectionalLight> VenueFill;
    UPROPERTY() TArray<TObjectPtr<APointLight>> StageLamps;
    UPROPERTY() TArray<TObjectPtr<APointLight>> BoilerRoomLamps;
    UPROPERTY() TArray<TObjectPtr<APointLight>> PyramidLamps;
    UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> FloorMaterial;
    UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> WallMaterial;
    UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> StudioMaterial;
    UPROPERTY() TObjectPtr<UActorComponent> BrowserInput;

    UPROPERTY() TArray<TObjectPtr<AStaticMeshActor>> BoothParts;
    UPROPERTY() TArray<TObjectPtr<AStaticMeshActor>> BoothSet;
    UPROPERTY() TArray<TObjectPtr<AStaticMeshActor>> BoothFurniture;
    UPROPERTY() TArray<TObjectPtr<AStaticMeshActor>> PyramidFurniture;
    UPROPERTY() TArray<TObjectPtr<AStaticMeshActor>> VenueActors;
    UPROPERTY() TArray<TObjectPtr<AStaticMeshActor>> CrateSleeves;
    UPROPERTY() TObjectPtr<UStaticMesh> FullSleeve;
    UPROPERTY() TObjectPtr<UStaticMesh> EmptySleeve;
    UPROPERTY() TObjectPtr<AStaticMeshActor> SelectionDisc;
    UPROPERTY() TObjectPtr<AStaticMeshActor> ReturnDisc;

    UPROPERTY() TObjectPtr<UAudioComponent> MasterAudio;
    UPROPERTY() TObjectPtr<USoundWaveProcedural> MasterWave;
    FSocket* AudioSocket = nullptr;
    uint32 AudioSequence = 0, AudioRate = 0;
    uint16 AudioGeneration = 0;
    bool bAudioSignal = false;
    float MasterLevel = 0, BassFollower = 0;
    double LastAudioPacketAt = -10;

    int32 Stage = 0;
    int32 BoothVenue = 0;
    FString MusicOwner;
    int64 LastSequence = -1, LastGesture = -1;
    double LastMusicAt = -10;
    bool bBoothVisible = false, bShowCrates = true, bShowTable = true;
    bool bWarehouseShell = false;
    bool bCinematic = false;
    enum class ECinemaShot : uint8 { Wide, Hero, Orbit, Crate, Handoff, Portrait, Dance };
    ECinemaShot CinemaShot = ECinemaShot::Wide;
    int32 CinemaSequence = -1;
    double NextCinemaShot = 0, CinemaShotSince = 0, AccentUntil = 0;
    float CinemaSide = 1.f, CameraFov = 53.f;
    float CinemaBlend = 0, CrateFramingBlend = 1;
    float CameraAngle = .12f;
    float DesiredCameraAngle = .12f;
    bool bCameraBound = false;
    bool bLiveBlend = false;
    FVector CameraFocus, CameraPosition;
    bool bCameraPoseSet = false;
    FString SleeveTracks[16];
    FString LastAnimatedTarget;
    int32 MountedSlots[2] = {INDEX_NONE,INDEX_NONE};
    TArray<FIntPoint> PendingRefiles;
    int32 PlayingDeck = INDEX_NONE, PickSlot = INDEX_NONE, PickDeck = INDEX_NONE;
    bool bPickConfirmed = false;
    FString TalkPhase;
    int64 LastMoveFeedback = 0;
    double PullStarted = -100, ReturnStarted = -100;
    FVector PerformerHome = FVector(0,30,140);
    double BoothClearanceDepth = 0;
    bool bAuditClearance = false;
    float ClearanceAuditAge = 0;
    double MinBoothGap = TNumericLimits<double>::Max();
    double MinPerformerBottom = TNumericLimits<double>::Max();
    double MaxBoothCorrection = 0;
    FRandomStream PerformanceRandom;
};
