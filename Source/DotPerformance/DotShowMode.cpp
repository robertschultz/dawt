#include "DotShowMode.h"
#include "DotPerformer.h"

#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/AudioComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/DirectionalLight.h"
#include "Engine/PointLight.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Modules/ModuleManager.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/UnrealType.h"
#include "Common/UdpSocketBuilder.h"
#include "Sockets.h"
#include "SocketSubsystem.h"
#include "Sound/SoundWaveProcedural.h"

IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, DotPerformance, "DotPerformance");

namespace
{
constexpr float CrateY = -109;
constexpr int32 BoilerRoomVenue = 3;
constexpr int32 FirstStudioVenue = 16;
constexpr int32 AlivePyramidVenue = 20;
const TCHAR* VenueNames[] = {TEXT("WarehouseShell"),TEXT("VenueFestival"),TEXT("VenueNightclub"),
    TEXT("VenueBoilerRoom"),TEXT("VenueRooftop"),TEXT("VenueDesert"),TEXT("VenueArcade"),TEXT("VenuePier"),
    TEXT("VenueListening"),TEXT("VenueObservatory"),TEXT("VenueEndUp"),TEXT("VenueTunnel"),
    TEXT("VenuePublicWorks"),TEXT("VenueSanFrancisco"),TEXT("VenueLosAngeles"),TEXT("VenueRoseBowl"),
    TEXT("StudioCharcoal"),TEXT("StudioIvory"),TEXT("StudioLilac"),TEXT("StudioMint"),TEXT("VenueAlivePyramid")};
const FLinearColor VenueFillColors[] = {{1,1,1},{1,.87,.70},{.73,.71,1},{.43,.60,1},{.84,.89,1},
    {1,.81,.62},{.86,.72,1},{.69,.88,1},{1,.79,.65},{.68,.81,1},{1,.88,.73},{.73,.77,1},
    {1,.80,.67},{1,.93,.84},{.84,.88,1},{1,.93,.80},{1,1,1},{1,1,1},{1,1,1},{1,1,1},{.77,.84,1}};
const FLinearColor StudioColors[] = {{.013,.018,.028},{.86,.80,.69},{.58,.44,.79},{.34,.66,.53}};
static_assert(UE_ARRAY_COUNT(VenueNames)==UE_ARRAY_COUNT(VenueFillColors));
constexpr bool IsStudioVenue(int32 Venue)
{
    return Venue >= FirstStudioVenue && Venue < FirstStudioVenue + UE_ARRAY_COUNT(StudioColors);
}
static_assert(AlivePyramidVenue == FirstStudioVenue + UE_ARRAY_COUNT(StudioColors));
constexpr float FirstSleeveY = -80.3f, SleeveSpacing = -6.48f;
constexpr double LocalPickLength = 2.2, RefileLength = 2.15;
constexpr float CrateCenters[] = {180,60,-60,-180};
int32 RecordCrate(const FJsonObject& Data, const TCHAR* Field)
{
    FString Genre;
    Data.TryGetStringField(Field,Genre);
    Genre.ToLowerInline();
    Genre.ReplaceInline(TEXT(" "),TEXT(""));
    Genre.ReplaceInline(TEXT("-"),TEXT(""));
    if (Genre==TEXT("house")) return 0;
    if (Genre==TEXT("deephouse")) return 1;
    if (Genre==TEXT("techhouse")) return 2;
    return 3;
}
float CrateCenter(int32 Slot) { return CrateCenters[Slot/4]; }
FVector SleeveHinge(int32 Slot) { return {CrateCenter(Slot),FirstSleeveY+(Slot%4)*SleeveSpacing,37.3}; }
FVector SleeveRecordCenter(int32 Slot) { return SleeveHinge(Slot) + FVector(0,0,33); }
FVector LocalRecordLift(int32 Slot)
{
    const float X = CrateCenter(Slot);
    return SleeveRecordCenter(Slot) + FVector(X < 0 ? -12 : 12,-18,FMath::Abs(X)<100 ? 42 : 55);
}
const FVector SetOrigin(0,-72,-58);

APointLight* PlaceLamp(UWorld* World, FVector Location, FLinearColor Color, float Power, float Radius, bool bShadows = false)
{
    auto* Lamp = World->SpawnActor<APointLight>(Location, FRotator::ZeroRotator);
    auto* Component = CastChecked<UPointLightComponent>(Lamp->GetLightComponent());
    Component->SetMobility(EComponentMobility::Movable);
    Component->SetIntensityUnits(ELightUnits::Candelas);
    Component->SetIntensity(Power);
    Component->SetLightColor(Color);
    Component->SetAttenuationRadius(1650);
    Component->SetSourceRadius(Radius);
    Component->SetCastShadows(bShadows);
    return Lamp;
}
}

ADotShowMode::ADotShowMode()
{
    PrimaryActorTick.bCanEverTick = true;
    DefaultPawnClass = nullptr;
    MasterAudio = CreateDefaultSubobject<UAudioComponent>(TEXT("AfterhoursMaster"));
    MasterAudio->bAutoActivate = false;
    MasterAudio->bAllowSpatialization = false;
}

void ADotShowMode::BeginPlay()
{
    Super::BeginPlay();
    bAuditClearance=FParse::Param(FCommandLine::Get(),TEXT("DotClearanceAudit"));
    UWorld* World = GetWorld();
    Performer = World->SpawnActor<ADotPerformer>(FVector(0,0,113), FRotator::ZeroRotator);
    if (Performer) AddTickPrerequisiteActor(Performer);
    PerformanceRandom.GenerateNewSeed();
    Camera = World->SpawnActor<ACameraActor>();
    Camera->GetCameraComponent()->SetFieldOfView(53);
    Camera->GetCameraComponent()->SetConstraintAspectRatio(false);
    Camera->GetCameraComponent()->PostProcessBlendWeight = 1;
    auto& Post = Camera->GetCameraComponent()->PostProcessSettings;
    Post.bOverride_AutoExposureMinBrightness = true;
    Post.bOverride_AutoExposureMaxBrightness = true;
    Post.AutoExposureMinBrightness = Post.AutoExposureMaxBrightness = 1;

    VenueFill = World->SpawnActor<ADirectionalLight>(FVector::ZeroVector, FRotator(-47,50,0));
    VenueFill->GetLightComponent()->SetMobility(EComponentMobility::Movable);
    VenueFill->GetLightComponent()->SetIntensity(1.35f);
    VenueFill->GetLightComponent()->SetCastShadows(false);
    StageLamps = {
        PlaceLamp(World, {-255,-345,390}, FLinearColor(1,.88,.80), 64, 60, true),
        PlaceLamp(World, {290,-155,241}, FLinearColor(.75,.83,1), 42, 46),
        PlaceLamp(World, {90,258,385}, FLinearColor(.71,.82,1), 94, 51),
        PlaceLamp(World, {-230,235,165}, FLinearColor(.86,.91,1), 36, 46),
        PlaceLamp(World, {8,-300,82}, FLinearColor(.88,.92,1), 15, 65)
    };
    BoilerRoomLamps = {
        PlaceLamp(World, {-140,-292,295}, FLinearColor(1,.72,.49), 48, 62, true),
        PlaceLamp(World, {240,-138,214}, FLinearColor(.48,.65,1), 28, 52),
        PlaceLamp(World, {-345,320,340}, FLinearColor(.12,.33,1), 135, 48),
        PlaceLamp(World, {330,320,329}, FLinearColor(.10,.29,1), 120, 48),
        PlaceLamp(World, {0,354,75}, FLinearColor(1,.29,.09), 92, 55)
    };
    PyramidLamps = {
        PlaceLamp(World, {-255,-292,366}, FLinearColor(.82,.88,1), 55, 68, true),
        PlaceLamp(World, {262,-134,285}, FLinearColor(.80,.83,1), 32, 54),
        PlaceLamp(World, {-338,290,265}, FLinearColor(.19,.32,1), 80, 43),
        PlaceLamp(World, {318,258,278}, FLinearColor(.64,.17,1), 69, 43),
        PlaceLamp(World, {14,184,61}, FLinearColor(1,.19,.08), 40, 52)
    };
    for (const auto& Lamp : BoilerRoomLamps) Lamp->GetLightComponent()->SetVisibility(false);
    for (const auto& Lamp : PyramidLamps) Lamp->GetLightComponent()->SetVisibility(false);

    auto* Plane = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Plane.Plane"));
    auto* Backdrop = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Dot/Materials/StageSurface.StageSurface"));
    const auto MakeStage = [World, Plane, Backdrop](FVector Location, FRotator Rotation, FVector Scale,
                                                   TObjectPtr<UMaterialInstanceDynamic>& Instance)
    {
        auto* Surface = World->SpawnActor<AStaticMeshActor>(Location, Rotation);
        auto* Mesh = Surface->GetStaticMeshComponent();
        Mesh->SetMobility(EComponentMobility::Movable);
        Mesh->SetStaticMesh(Plane);
        Mesh->SetWorldScale3D(Scale);
        if (Backdrop)
        {
            Instance = UMaterialInstanceDynamic::Create(Backdrop, Surface);
            Mesh->SetMaterial(0, Instance);
        }
        return Surface;
    };
    StageFloor = MakeStage({0,0,0}, FRotator::ZeroRotator, FVector(70), FloorMaterial);
    StageWall = MakeStage({0,390,350}, FRotator(0,0,90), FVector(24), WallMaterial);
    if (auto* Solid = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Dot/Materials/StudioSolid.StudioSolid")))
        StudioMaterial = UMaterialInstanceDynamic::Create(Solid, this);
    ApplyStage();
    BuildBooth();
    AudioSocket = FUdpSocketBuilder(TEXT("Dot Afterhours PCM"))
        .AsNonBlocking().BoundToEndpoint(FIPv4Endpoint(FIPv4Address(127,0,0,1),8177))
        .WithReceiveBufferSize(128*1024);
    UE_LOG(LogTemp, Display, TEXT("DOT_MASTER_RECEIVER ready=%d"), AudioSocket != nullptr);

    if (auto* InputClass = LoadClass<UActorComponent>(nullptr, TEXT("/Script/PixelStreaming2.PixelStreaming2Input")))
    {
        BrowserInput = NewObject<UActorComponent>(this, InputClass, TEXT("BrowserInput"));
        AddInstanceComponent(BrowserInput);
        BrowserInput->RegisterComponent();
        if (auto* Event = FindFProperty<FMulticastDelegateProperty>(InputClass, TEXT("OnInputEvent")))
        {
            FScriptDelegate Handler;
            Handler.BindUFunction(this, TEXT("ReceiveBrowserInput"));
            Event->AddDelegate(Handler, BrowserInput);
        }
    }
    UE_LOG(LogTemp, Display, TEXT("DOT_READY meshes=%d streamInput=%d"),
        IsValid(Performer) && Performer->HasMeshes(), IsValid(BrowserInput));
}

void ADotShowMode::ApplyStage()
{
    const FLinearColor Floors[] = {{.016,.027,.044}, {.16,.125,.096}, {.035,.019,.056}, {.009,.010,.014}};
    const FLinearColor Walls[] = {{.013,.022,.038}, {.18,.135,.096}, {.051,.019,.075}, {.009,.010,.014}};
    if (FloorMaterial) FloorMaterial->SetVectorParameterValue(TEXT("Tint"), Floors[Stage]);
    if (WallMaterial) WallMaterial->SetVectorParameterValue(TEXT("Tint"), Walls[Stage]);
    if (StageFloor) StageFloor->SetActorHiddenInGame(bBoothVisible ? bWarehouseShell : Stage == 3);
}

void ADotShowMode::UpdateCamera(float DeltaSeconds)
{
    if (!Camera) return;
    CameraAngle = FMath::FInterpTo(CameraAngle, DesiredCameraAngle, DeltaSeconds, 4);
    CinemaBlend = FMath::FInterpTo(CinemaBlend, bBoothVisible && bCinematic ? 1.f : 0.f, DeltaSeconds, 3.2f);
    const bool bPyramid = bBoothVisible && BoothVenue == AlivePyramidVenue;
    const float SceneWidth = bPyramid ? 64.f : 53.f;
    const float Distance = bPyramid ? 1360.f : bBoothVisible ? 835.f : 690.f;
    CrateFramingBlend = FMath::FInterpTo(CrateFramingBlend, bShowCrates ? 1.f : 0.f, DeltaSeconds, 3.2f);
    const float Height = bPyramid ? 205.f : bBoothVisible ? 320.f : 240.f;
    const float FocusHeight = bPyramid ? 126.f : bBoothVisible ? FMath::Lerp(145.f,130.f,CrateFramingBlend) : 142.f;
    const FVector Orbit(Distance*FMath::Sin(CameraAngle), -Distance*FMath::Cos(CameraAngle), Height);
    FVector Position = Orbit, Focus(0,-32,FocusHeight);
    float Fov=SceneWidth;
    if (bBoothVisible && bCinematic)
    {
        const double Now=GetWorld()->GetTimeSeconds();
        if (CinemaSequence<0)
        {
            CinemaSequence=0;
            CinemaSide=-1.f;
            NextCinemaShot=Now+5.5;
            AccentUntil=0;
            CinemaShotSince=Now;
        }
        const bool bPulling=bShowCrates && PickSlot!=INDEX_NONE && Now-PullStarted<LocalPickLength;
        const bool bRefiling=bShowCrates && !PendingRefiles.IsEmpty() && Now-ReturnStarted<RefileLength;
        const bool bInConversation=TalkPhase==TEXT("speaking") || TalkPhase==TEXT("hearing");
        if (Performer && Performer->IsInDanceAccent()) AccentUntil=Now+2.4;
        const bool bDance=Now<AccentUntil;
        if (!bPulling && !bRefiling && !bLiveBlend && !bInConversation && !bDance && Now>=NextCinemaShot)
        {
            ++CinemaSequence;
            CinemaSide=(CinemaSequence%2==0) ? -1.f : 1.f;
            NextCinemaShot=Now+(CinemaSequence%3==1 ? 5.5 : 6.5);
        }
        const ECinemaShot AmbientShots[]={ECinemaShot::Wide,ECinemaShot::Hero,ECinemaShot::Orbit};
        ECinemaShot Desired=AmbientShots[CinemaSequence%UE_ARRAY_COUNT(AmbientShots)];
        if (bDance) Desired=ECinemaShot::Dance;
        if (bInConversation) Desired=ECinemaShot::Portrait;
        if (bLiveBlend) Desired=ECinemaShot::Handoff;
        if (bPulling || bRefiling) Desired=ECinemaShot::Crate;
        if (Desired!=CinemaShot)
        {
            CinemaShot=Desired;
            CinemaShotSince=Now;
            const TCHAR* Names[]={TEXT("wide"),TEXT("hero"),TEXT("orbit"),TEXT("crate"),TEXT("handoff"),TEXT("portrait"),TEXT("dance")};
            UE_LOG(LogTemp, Display, TEXT("DOT_CINEMA shot=%s"),Names[static_cast<int32>(CinemaShot)]);
        }

        const FVector Dot=Performer ? Performer->CameraSubjectLocation() : PerformerHome;
        const float X=FMath::Clamp(Dot.X,-140.0,140.0);
        const float Lift=FMath::Clamp(Dot.Z-PerformerHome.Z,-25.0,85.0);
        const float Age=float(Now-CinemaShotSince);
        const float Move=FMath::SmoothStep(0.f,5.f,Age);
        const float Push=FMath::SmoothStep(0.f,2.f,Age);
        FVector Shot,Subject;
        float Lens=53.f;
        switch (CinemaShot)
        {
            case ECinemaShot::Wide:
                Shot={CinemaSide*(280.f-143.f*Move),-952.f+62.f*Move,370.f-44.f*Move};
                Subject={X*.14f,-31,125};
                if (bPyramid)
                {
                    Shot={CinemaSide*(196.f-92.f*Move),-1440.f+62.f*Move,222.f-18.f*Move};
                    Subject.Z=126;
                    Lens=SceneWidth;
                }
                break;
            case ECinemaShot::Hero:
                Shot={CinemaSide*(174.f-82.f*Move),-700.f+61.f*Move,240.f+15.f*Move};
                Subject={X*.46f,-29,142+Lift*.36f};
                Lens=44;
                break;
            case ECinemaShot::Orbit:
                Shot={CinemaSide*(90.f+278.f*Move),-755.f+67.f*Move,285.f+56.f*Move};
                Subject={X*.28f,-36,134+Lift*.28f};
                Lens=50;
                break;
            case ECinemaShot::Crate:
            {
                const float Crate=CrateCenter(bPulling ? PickSlot : PendingRefiles[0].X);
                const float Side=Crate<0 ? -1.f : 1.f;
                Shot={Crate*.58f+Side*(111.f-27.f*Push),-588.f+66.f*Push,316.f-19.f*Push};
                Subject={Crate*.77f,CrateY,110.f+17.f*Push};
                Lens=44;
                break;
            }
            case ECinemaShot::Handoff:
                Shot={CinemaSide*(207.f-145.f*Move),-754.f+54.f*Move,290.f-24.f*Move};
                Subject={X*.19f,-69,121};
                Lens=50;
                break;
            case ECinemaShot::Portrait:
                Shot={CinemaSide*104+X*.26f,-638.f+38.f*Move,220};
                Subject={X*.65f,-18,155+Lift*.30f};
                Lens=43;
                break;
            case ECinemaShot::Dance:
                Shot={CinemaSide*170+X*.38f,-835,303+Lift*.35f};
                Subject={X*.68f,-24,146+Lift*.40f};
                Lens=52;
                break;
        }
        Position=FMath::Lerp(Orbit,Shot,CinemaBlend);
        Focus=FMath::Lerp(Focus,Subject,CinemaBlend);
        Fov=FMath::Lerp(SceneWidth,Lens,CinemaBlend);
    }
    else
    {
        CinemaSequence=-1;
        CinemaShot=ECinemaShot::Wide;
    }
    CameraPosition = bCameraPoseSet ? FMath::VInterpTo(CameraPosition,Position,DeltaSeconds,2.15f) : Position;
    CameraFocus = bCameraPoseSet ? FMath::VInterpTo(CameraFocus,Focus,DeltaSeconds,2.40f) : Focus;
    bCameraPoseSet = true;
    Camera->SetActorLocation(CameraPosition);
    Camera->SetActorRotation((CameraFocus - CameraPosition).Rotation());
    CameraFov=FMath::FInterpTo(CameraFov,Fov,DeltaSeconds,2.4f);
    Camera->GetCameraComponent()->SetFieldOfView(CameraFov);
    if (StageWall)
    {
        const FVector Behind(-460*FMath::Sin(CameraAngle), 460*FMath::Cos(CameraAngle), 330);
        StageWall->SetActorLocation(Behind);
        StageWall->SetActorRotation(FRotator(0, FMath::RadiansToDegrees(CameraAngle), 90));
    }
}

void ADotShowMode::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (auto* Controller = GetWorld()->GetFirstPlayerController())
    {
        if (!bCameraBound && Camera)
        {
            Controller->SetViewTarget(Camera);
            bCameraBound = true;
        }
        const TPair<FKey, const TCHAR*> Commands[] = {
            {EKeys::One,TEXT("show")}, {EKeys::Two,TEXT("bounce")}, {EKeys::Three,TEXT("glide")},
            {EKeys::Four,TEXT("spin")}, {EKeys::Five,TEXT("dance")}, {EKeys::H,TEXT("headphones")},
            {EKeys::C,TEXT("cinematicToggle")}, {EKeys::B,TEXT("stage")}, {EKeys::SpaceBar,TEXT("pause")}, {EKeys::V,TEXT("view")}
        };
        for (const auto& Pair : Commands)
        {
            if (Controller->WasInputKeyJustPressed(Pair.Key)) SetCommand(Pair.Value);
        }
        const float Direction = (Controller->IsInputKeyDown(EKeys::Right) ? 1.f : 0.f)
                              - (Controller->IsInputKeyDown(EKeys::Left) ? 1.f : 0.f);
        if (Performer) Performer->MoveAcrossStage(Direction, DeltaSeconds);
    }
    UpdateCamera(DeltaSeconds);
    if (GetWorld()->GetTimeSeconds() - LastMusicAt > 1.5)
    {
        bLiveBlend = false;
        TalkPhase.Reset();
    }
    TickBooth(DeltaSeconds);
    MaintainBoothClearance(DeltaSeconds);
    TickMasterAudio();
}

void ADotShowMode::ReceiveBrowserInput(const FString& Message)
{
    TSharedPtr<FJsonObject> Object;
    FString Command;
    if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Message), Object)
        && Object.IsValid() && Object->TryGetStringField(TEXT("action"), Command))
    {
        if (Command == TEXT("afterhours")) ReceiveMusic(*Object);
        else if (Command == TEXT("cinematic"))
        {
            Object->TryGetBoolField(TEXT("enabled"),bCinematic);
            UE_LOG(LogTemp, Display, TEXT("DOT_CAMERA cinematic=%d"), bCinematic);
        }
        else if (Command == TEXT("headphonesSet") && Performer)
        {
            bool bVisible;
            if (Object->TryGetBoolField(TEXT("visible"), bVisible))
                Performer->SetHeadphonesVisible(bVisible);
        }
        else SetCommand(Command);
    }
}

void ADotShowMode::SetCommand(const FString& Command)
{
    if (!Performer) return;
    if (Command == TEXT("show") || Command == TEXT("bounce") || Command == TEXT("glide") ||
        Command == TEXT("spin") || Command == TEXT("dance"))
    {
        MusicOwner.Reset();
        LastMusicAt = -10;
        SetBoothVisible(false);
    }
    if (Command == TEXT("show")) Performer->Cue(EDotMove::Show);
    else if (Command == TEXT("bounce")) Performer->Cue(EDotMove::Bounce);
    else if (Command == TEXT("glide")) Performer->Cue(EDotMove::Glide);
    else if (Command == TEXT("spin")) Performer->Cue(EDotMove::Spin);
    else if (Command == TEXT("dance")) Performer->Cue(EDotMove::Dance);
    else if (Command == TEXT("pause")) Performer->SetPaused(!Performer->IsPaused());
    else if (Command == TEXT("headphones")) Performer->SetHeadphonesVisible(!Performer->HasHeadphones());
    else if (Command == TEXT("stage")) { Stage = (Stage + 1) % 4; ApplyStage(); }
    else if (Command == TEXT("cinematicToggle")) bCinematic = !bCinematic;
    else if (Command == TEXT("view")) DesiredCameraAngle += UE_PI/2;
    else return;
    UE_LOG(LogTemp, Display, TEXT("DOT_CONTROL %s mode=%d paused=%d headset=%d stage=%d"),
        *Command, int32(Performer->GetMove()), Performer->IsPaused(), Performer->HasHeadphones(), Stage);
}

void ADotShowMode::ReceiveMusic(const FJsonObject& Data)
{
    FString Owner;
    double Sequence = 0, Beat = 0, Bpm = 0;
    bool Playing = false;
    if (!Performer || !Data.TryGetStringField(TEXT("owner"), Owner) || Owner.IsEmpty() || Owner.Len() > 48 ||
        !Data.TryGetNumberField(TEXT("sequence"), Sequence) || !FMath::IsFinite(Sequence) || Sequence < 0 || Sequence > 1.e12 ||
        !Data.TryGetNumberField(TEXT("beat"), Beat) || !FMath::IsFinite(Beat) || FMath::Abs(Beat) > 1.e7 ||
        !Data.TryGetNumberField(TEXT("bpm"), Bpm) || !FMath::IsFinite(Bpm) || Bpm < 45 || Bpm > 240 ||
        !Data.TryGetBoolField(TEXT("playing"), Playing)) return;

    const double Now = GetWorld()->GetTimeSeconds();
    if (Owner != MusicOwner)
    {
        bool bClaim = false;
        Data.TryGetBoolField(TEXT("claim"), bClaim);
        if (!bClaim && Now - LastMusicAt < 1.25) return;
        MusicOwner = Owner;
        LastSequence = LastGesture = -1;
        LastMoveFeedback = 0;
    }
    if (Sequence <= LastSequence) return;
    const auto Read = [&Data](const TCHAR* Name, double Min, double Max)
    {
        double Value = 0;
        return Data.TryGetNumberField(Name, Value) && FMath::IsFinite(Value)
            ? FMath::Clamp(Value, Min, Max) : Min;
    };
    LastSequence = int64(Sequence);
    LastMusicAt = Now;
    FDotMusicFrame Frame;
    Frame.Beat = Beat;
    Frame.Bpm = float(Bpm);
    Frame.bPlaying = Playing;
    Frame.Energy = float(Read(TEXT("energy"), 0, 1));
    Frame.Bass = float(Read(TEXT("bass"), 0, 1));
    FString Origin;
    if (Playing && Data.TryGetStringField(TEXT("origin"), Origin) && Origin == TEXT("native") && Now - LastAudioPacketAt < .35)
    {
        Frame.Bass = MasterLevel;
        Frame.Energy = FMath::Clamp(.47f * Frame.Energy + .53f * MasterLevel, 0.f, 1.f);
    }
    Frame.Deck = Read(TEXT("deck"), 0, 1) >= .5 ? 1 : 0;
    Frame.Incoming = Read(TEXT("incoming"), 0, 1) >= .5 ? 1 : 0;
    Frame.Fader = float(Read(TEXT("fader"), 0, 1));
    Frame.Progress = float(Read(TEXT("progress"), 0, 1));
    Data.TryGetBoolField(TEXT("mixing"), Frame.bMixing);
    Data.TryGetBoolField(TEXT("scheduled"), Frame.bScheduled);
    Data.TryGetStringField(TEXT("gesture"), Frame.Gesture);
    FDotTalkFrame Talk;
    FString IncomingTalk, Mood;
    Data.TryGetStringField(TEXT("talkPhase"),IncomingTalk);
    Data.TryGetStringField(TEXT("talkEmotion"),Mood);
    if (IncomingTalk==TEXT("listening")) Talk.Phase=EDotTalkPhase::Listening;
    else if (IncomingTalk==TEXT("hearing")) Talk.Phase=EDotTalkPhase::Hearing;
    else if (IncomingTalk==TEXT("speaking")) Talk.Phase=EDotTalkPhase::Speaking;
    else if (IncomingTalk==TEXT("working")) Talk.Phase=EDotTalkPhase::Working;
    else IncomingTalk.Reset();
    if (Mood==TEXT("warm")) Talk.Mood=EDotMood::Warm;
    else if (Mood==TEXT("curious")) Talk.Mood=EDotMood::Curious;
    else if (Mood==TEXT("excited")) Talk.Mood=EDotMood::Excited;
    else if (Mood==TEXT("concerned")) Talk.Mood=EDotMood::Concerned;
    Talk.Level=float(Read(TEXT("talkLevel"),0,1));
    Performer->SetTalkFrame(Talk);
    const int64 FeedbackId=int64(Read(TEXT("moveFeedbackId"),0,1.e12));
    if (FeedbackId>LastMoveFeedback && Talk.Phase!=EDotTalkPhase::Idle)
    {
        FString Move;
        Data.TryGetStringField(TEXT("moveFeedbackName"),Move);
        double Direction=0;
        if (Data.TryGetNumberField(TEXT("moveFeedbackDirection"),Direction) && (Direction==-1||Direction==1))
            Performer->LearnMove(Move,int32(Direction));
        LastMoveFeedback=FeedbackId;
    }
    if (IncomingTalk!=TalkPhase)
    {
        TalkPhase=IncomingTalk;
        UE_LOG(LogTemp,Display,TEXT("DOT_TALK phase=%s"),*TalkPhase);
    }
    const int64 Gesture = int64(Read(TEXT("gestureId"), 0, 1.e12));
    Performer->SetMusicFrame(Frame, Gesture != LastGesture);
    if (Gesture != LastGesture && !Frame.Gesture.IsEmpty())
    {
        UE_LOG(LogTemp, Display, TEXT("DOT_AFTERHOURS event=%s bpm=%.1f beat=%.2f fader=%.2f"),
            *Frame.Gesture.Left(24), Frame.Bpm, Frame.Beat, Frame.Fader);
    }
    LastGesture = Gesture;
    bool bCrates;
    if (Data.TryGetBoolField(TEXT("showCrates"),bCrates) || Data.TryGetBoolField(TEXT("showDecks"),bCrates))
        SetCrateVisibility(bCrates);
    bool bTable;
    if (Data.TryGetBoolField(TEXT("showTable"),bTable))
        SetTableVisibility(bTable);
    bLiveBlend = Frame.bMixing;
    double RequestedVenue=0;
    if (Data.TryGetNumberField(TEXT("venue"),RequestedVenue) && FMath::IsFinite(RequestedVenue) &&
        RequestedVenue>=0 && RequestedVenue<UE_ARRAY_COUNT(VenueNames))
        SetBoothVenue(int32(RequestedVenue));
    ReadPerformanceCue(Data,Frame.Deck,Frame.Incoming,Playing,Now);
    SetBoothVisible(true);
}

void ADotShowMode::BuildBooth()
{
    auto* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    auto* Disc = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    auto* Record = LoadObject<UStaticMesh>(nullptr,TEXT("/Game/Dot/Warehouse/BoothRecord.BoothRecord"));
    if (!Record) Record = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Dot/Meshes/DotRecord.DotRecord"));
    auto* Surface = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Dot/Materials/StageSurface.StageSurface"));
    if (!Cube || !Disc || !Surface) return;

    const auto Spawn = [this](UStaticMesh* Shape, FVector Position, FVector Scale, FRotator Rotation,
                              TArray<TObjectPtr<AStaticMeshActor>>& Group)
    {
        auto* Actor = GetWorld()->SpawnActor<AStaticMeshActor>(Position, Rotation);
        auto* Mesh = Actor->GetStaticMeshComponent();
        Mesh->SetMobility(EComponentMobility::Movable);
        Mesh->SetStaticMesh(Shape);
        Mesh->SetWorldScale3D(Scale);
        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Actor->SetActorHiddenInGame(true);
        Group.Add(Actor);
        return Actor;
    };
    const auto Part = [&Spawn,Surface](UStaticMesh* Shape, FVector Position, FVector Scale, FLinearColor Tint,
                                      TArray<TObjectPtr<AStaticMeshActor>>& Group)
    {
        auto* Actor = Spawn(Shape,Position,Scale,FRotator::ZeroRotator,Group);
        auto* Material = UMaterialInstanceDynamic::Create(Surface, Actor);
        Material->SetVectorParameterValue(TEXT("Tint"), Tint);
        Actor->GetStaticMeshComponent()->SetMaterial(0,Material);
        return Actor;
    };
    const auto LoadSet = [&Spawn](const TCHAR* Name, TArray<TObjectPtr<AStaticMeshActor>>& Group)
    {
        const FString Path = FString::Printf(TEXT("/Game/Dot/Warehouse/%s.%s"),Name,Name);
        auto* Mesh = LoadObject<UStaticMesh>(nullptr,*Path);
        if (!Mesh) return false;
        Spawn(Mesh,SetOrigin,FVector(1),FRotator(0,180,0),Group);
        return true;
    };

    VenueActors.SetNum(UE_ARRAY_COUNT(VenueNames));
    bWarehouseShell = LoadSet(TEXT("WarehouseShell"),BoothSet);
    if (bWarehouseShell) VenueActors[0]=BoothSet.Pop();
    if (!bWarehouseShell)
    {
        const FLinearColor Dark(.055,.063,.075), Brick(.36,.23,.16), Window(.72,.79,.89);
        Part(Cube,{0,365,82},{10,.18,2.7},Brick,BoothSet);
        Part(Cube,{0,369,401},{10,.18,3.7},Window,BoothSet);
        for (int32 Column = -7; Column <= 7; ++Column)
            Part(Cube,{Column*69.f,355,405},{.037,.14,3.62},Dark,BoothSet);
        for (float Z : {226.f,293.f,359.f,425.f,491.f,557.f})
            Part(Cube,{0,355,Z},{10,.14,.039},Dark,BoothSet);
        for (float X : {-395.f,-190.f,190.f,395.f})
            Part(Cube,{X,333,235},{.19,.24,4.7},Dark,BoothSet);
        for (int32 Row=0; Row<7; ++Row)
        {
            const float Z = 17.f+Row*28.f;
            Part(Cube,{0,354,Z},{10,.008,.008},{.27,.18,.15},BoothSet);
            for (int32 Column=-8; Column<=8; ++Column)
                Part(Cube,{60.f*Column+(Row%2)*30.f,353,Z-14},{.008,.008,.28},{.27,.18,.15},BoothSet);
        }
    }
    if (!LoadSet(TEXT("BoothFurniture"),BoothFurniture))
    {
        Part(Cube,{0,-115,26},{5.15,1.37,.09},{.064,.063,.074},BoothFurniture);
        Part(Cube,{0,-173,-8},{5.03,.10,.63},{.021,.027,.039},BoothFurniture);
    }
    LoadSet(TEXT("AlivePyramidPodium"),PyramidFurniture);
    const bool bImportedCrates = LoadSet(TEXT("BoothFourCrates"),BoothParts);
    if (!bImportedCrates)
    {
        const FLinearColor Sage(.27,.39,.38);
        const FLinearColor Colors[] = {{.78,.42,.31},{.54,.63,.73},{.82,.68,.31},{.36,.56,.59}};
        for (float X : CrateCenters)
        {
            Part(Cube,{X,CrateY,35},{.80,.78,.09},Sage,BoothParts);
            Part(Cube,{X,CrateY-37,48},{.80,.035,.29},Sage,BoothParts);
            Part(Cube,{X,CrateY+37,49},{.80,.035,.31},Sage,BoothParts);
            for (float Rim : {-38,38})
                Part(Cube,{X+Rim,CrateY,53},{.045,.78,.39},Sage,BoothParts);
            for (int32 Sleeve=0; Sleeve<8; ++Sleeve)
                Part(Cube,{X,CrateY-28+Sleeve*8.f,73},{.70,.025,.66},Colors[Sleeve%4],BoothParts);
        }
    }
    if (bImportedCrates)
    {
        FullSleeve = LoadObject<UStaticMesh>(nullptr,TEXT("/Game/Dot/Warehouse/BrowseSleeve.BrowseSleeve"));
        EmptySleeve = LoadObject<UStaticMesh>(nullptr,TEXT("/Game/Dot/Warehouse/BrowseSleeveEmpty.BrowseSleeveEmpty"));
        if (FullSleeve)
        {
            for (int32 Slot=0; Slot<16; ++Slot)
                CrateSleeves.Add(Spawn(FullSleeve,SleeveHinge(Slot),FVector(1),
                    FRotator(0,0,6.f-1.35f*(Slot%4)),BoothParts));
        }

    }
    const auto FlyingRecord = [&]()
    {
        return Record ? Spawn(Record,FVector::ZeroVector,FVector(1),FRotator::ZeroRotator,BoothParts)
                      : Part(Disc,FVector::ZeroVector,{.71,.71,.032},{.023,.025,.034},BoothParts);
    };
    SelectionDisc = FlyingRecord();
    ReturnDisc = FlyingRecord();
    UE_LOG(LogTemp, Display, TEXT("DOT_WAREHOUSE imported=%d equipment=%d sleeves=%d"), bWarehouseShell,BoothParts.Num(),CrateSleeves.Num());
}

void ADotShowMode::SetBoothVenue(int32 Venue)
{
    if (Venue==BoothVenue || !VenueActors.IsValidIndex(Venue)) return;
    auto& Actor=VenueActors[Venue];
    if (IsStudioVenue(Venue) && !StudioMaterial) return;
    if (!IsStudioVenue(Venue) && !Actor)
    {
        const FString Path=FString::Printf(TEXT("/Game/Dot/Warehouse/%s.%s"),VenueNames[Venue],VenueNames[Venue]);
        auto* Asset=LoadObject<UStaticMesh>(nullptr,*Path);
        if (!Asset) return;
        Actor=GetWorld()->SpawnActor<AStaticMeshActor>(SetOrigin,FRotator(0,180,0));
        auto* Mesh=Actor->GetStaticMeshComponent();
        Mesh->SetMobility(EComponentMobility::Movable);
        Mesh->SetStaticMesh(Asset);
        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    }
    BoothVenue=Venue;
    UpdateVenueVisibility();
    UE_LOG(LogTemp,Display,TEXT("DOT_VENUE scene=%s"),VenueNames[Venue]);
}

void ADotShowMode::UpdateVenueVisibility()
{
    const bool bStudio = bBoothVisible && IsStudioVenue(BoothVenue) && StudioMaterial;
    if (bStudio)
        StudioMaterial->SetVectorParameterValue(TEXT("Color"),StudioColors[BoothVenue-FirstStudioVenue]);
    for (int32 Index=0; Index<VenueActors.Num(); ++Index)
        if (auto* Actor=VenueActors[Index].Get()) Actor->SetActorHiddenInGame(!bBoothVisible||Index!=BoothVenue);
    if (StageFloor && bBoothVisible)
        StageFloor->SetActorHiddenInGame(VenueActors.IsValidIndex(BoothVenue)&&VenueActors[BoothVenue]!=nullptr);
    if (StageFloor)
        StageFloor->GetStaticMeshComponent()->SetMaterial(0,bStudio ? StudioMaterial.Get() : FloorMaterial.Get());
    if (StageWall)
    {
        StageWall->GetStaticMeshComponent()->SetMaterial(0,bStudio ? StudioMaterial.Get() : WallMaterial.Get());
        if (bBoothVisible) StageWall->SetActorHiddenInGame(!bStudio);
    }
    const bool bBoilerRoom = bBoothVisible && BoothVenue==BoilerRoomVenue;
    const bool bPyramid = bBoothVisible && BoothVenue==AlivePyramidVenue;
    for (const auto& Lamp : StageLamps) Lamp->GetLightComponent()->SetVisibility(!bBoilerRoom && !bPyramid);
    for (const auto& Lamp : PyramidLamps) Lamp->GetLightComponent()->SetVisibility(bPyramid);
    UpdateTableVisibility();
    for (const auto& Lamp : BoilerRoomLamps) Lamp->GetLightComponent()->SetVisibility(bBoilerRoom);
    if (VenueFill)
    {
        auto* Fill = VenueFill->GetLightComponent();
        Fill->SetIntensity(bBoilerRoom ? .26f : bPyramid ? .43f : 1.35f);
        Fill->SetLightColor(bBoothVisible?VenueFillColors[BoothVenue]:FLinearColor::White);
    }
}

bool ADotShowMode::IsSleeveEmpty(int32 Slot) const
{
    return MountedSlots[0]==Slot || MountedSlots[1]==Slot ||
        PendingRefiles.ContainsByPredicate([Slot](const FIntPoint& Item) { return Item.X==Slot; });
}

int32 ADotShowMode::FindShelfSlot(const FString& Track, int32 Crate)
{
    for (int32 Slot=0; Slot<16; ++Slot)
        if (SleeveTracks[Slot]==Track) return Slot;

    const int32 Start = PerformanceRandom.RandRange(0,3);
    for (int32 Pass=0; Pass<2; ++Pass)
    {
        for (int32 Offset=0; Offset<4; ++Offset)
        {
            const int32 Slot = Crate*4 + (Start + Offset)%4;
            if (IsSleeveEmpty(Slot) || (Pass==0 && !SleeveTracks[Slot].IsEmpty())) continue;
            SleeveTracks[Slot] = Track;
            return Slot;
        }
    }
    return INDEX_NONE;
}

void ADotShowMode::QueueRefile(int32 Deck)
{
    const int32 Slot = MountedSlots[Deck];
    if (Slot==INDEX_NONE) return;
    MountedSlots[Deck] = INDEX_NONE;
    PendingRefiles.Emplace(Slot,Deck);
}

void ADotShowMode::ReadPerformanceCue(const FJsonObject& Data, int32 Deck, int32 Incoming, bool bPlaying, double Now)
{
    bool bFinished = false;
    Data.TryGetBoolField(TEXT("recordFinished"),bFinished);
    if (bFinished)
    {
        QueueRefile(0);
        QueueRefile(1);
        PlayingDeck = PickSlot = PickDeck = INDEX_NONE;
        LastAnimatedTarget.Reset();
        return;
    }

    FString Current;
    if (bPlaying && Data.TryGetStringField(TEXT("currentRecord"),Current) && !Current.IsEmpty())
    {
        Current.LeftInline(112);
        if (PlayingDeck!=INDEX_NONE && PlayingDeck!=Deck)
        {
            QueueRefile(PlayingDeck);
            LastAnimatedTarget.Reset();
        }
        PlayingDeck = Deck;
        const int32 CurrentSlot = FindShelfSlot(Current,RecordCrate(Data,TEXT("currentGenre")));
        if (CurrentSlot!=INDEX_NONE && MountedSlots[Deck]!=CurrentSlot)
        {
            QueueRefile(Deck);
            MountedSlots[Deck] = CurrentSlot;
            UE_LOG(LogTemp,Display,TEXT("DOT_RECORD_MOUNT deck=%d sleeve=%d track=%s"),Deck,CurrentSlot+1,*Current);
        }
        if (CurrentSlot==PickSlot && PickDeck==Deck) bPickConfirmed=true;
    }

    FString Target;
    if (!Data.TryGetStringField(TEXT("recordTarget"),Target) || Target.IsEmpty() || Target==Current ||
        PlayingDeck==Incoming || PickSlot!=INDEX_NONE || !PendingRefiles.IsEmpty()) return;
    Target.LeftInline(112);
    if (Target==LastAnimatedTarget) return;
    const int32 Slot = FindShelfSlot(Target,RecordCrate(Data,TEXT("targetGenre")));
    if (Slot==INDEX_NONE || IsSleeveEmpty(Slot)) return;
    if (MountedSlots[Incoming]!=INDEX_NONE)
    {
        QueueRefile(Incoming);
        return;
    }
    PickSlot = Slot;
    PickDeck = Incoming;
    MountedSlots[Incoming] = Slot;
    PullStarted = Now;
    LastAnimatedTarget = Target;
    bPickConfirmed = false;
    UE_LOG(LogTemp,Display,TEXT("DOT_RECORD_PULL deck=%d sleeve=%d track=%s"),Incoming,Slot+1,*Target);
}

void ADotShowMode::SetBoothVisible(bool bVisible)
{
    if (bVisible == bBoothVisible) return;
    bBoothVisible = bVisible;
    BoothClearanceDepth = 0;
    DesiredCameraAngle = bVisible ? 0 : .12f;
    for (const auto& Part : BoothSet) Part->SetActorHiddenInGame(!bVisible);
    for (const auto& Part : BoothParts) Part->SetActorHiddenInGame(!(bVisible && bShowCrates));
    if (SelectionDisc) SelectionDisc->SetActorHiddenInGame(true);
    if (ReturnDisc) ReturnDisc->SetActorHiddenInGame(true);
    if (StageFloor)
    {
        StageFloor->SetActorLocation(bVisible ? FVector(0,0,-57) : FVector::ZeroVector);
        StageFloor->SetActorHiddenInGame(bVisible && bWarehouseShell);
    }
    if (StageWall) StageWall->SetActorHiddenInGame(bVisible);
    UpdateVenueVisibility();
    if (FloorMaterial && bVisible) FloorMaterial->SetVectorParameterValue(TEXT("Tint"), FLinearColor(.18,.20,.23));
    if (!bVisible) ApplyStage();
    if (Performer)
    {
        Performer->SetActorLocation(bVisible ? PerformerHome : FVector(0,0,113));
        Performer->SetActorScale3D(FVector(bVisible ? .91f : 1.f));
    }
}

void ADotShowMode::SetTableVisibility(bool bVisible)
{
    if (bShowTable == bVisible) return;
    bShowTable = bVisible;
    UpdateTableVisibility();
    UE_LOG(LogTemp, Display, TEXT("DOT_TABLE_VISIBILITY visible=%d"), bShowTable);
}

void ADotShowMode::UpdateTableVisibility()
{
    const bool bTable = bBoothVisible && bShowTable;
    const bool bPyramidPodium = BoothVenue==AlivePyramidVenue && !PyramidFurniture.IsEmpty();
    for (const auto& Part : BoothFurniture) Part->SetActorHiddenInGame(!bTable || bPyramidPodium);
    for (const auto& Part : PyramidFurniture) Part->SetActorHiddenInGame(!bTable || !bPyramidPodium);
}

void ADotShowMode::SetCrateVisibility(bool bVisible)
{
    if (bShowCrates == bVisible) return;
    bShowCrates = bVisible;
    for (const auto& Part : BoothParts) Part->SetActorHiddenInGame(!(bBoothVisible && bShowCrates));
    if (SelectionDisc) SelectionDisc->SetActorHiddenInGame(true);
    if (ReturnDisc) ReturnDisc->SetActorHiddenInGame(true);
    UE_LOG(LogTemp, Display, TEXT("DOT_CRATE_VISIBILITY visible=%d"), bShowCrates);
}

void ADotShowMode::TickBooth(float DeltaSeconds)
{
    if (!bBoothVisible || !Performer) return;
    const double Now = GetWorld()->GetTimeSeconds();
    const double Pull = Now - PullStarted;
    if (PickSlot!=INDEX_NONE && bPickConfirmed && Pull>=LocalPickLength)
        PickSlot=PickDeck=INDEX_NONE;
    else if (PickSlot!=INDEX_NONE && !bPickConfirmed && Pull>25)
    {
        if (MountedSlots[PickDeck]==PickSlot) MountedSlots[PickDeck]=INDEX_NONE;
        PickSlot=PickDeck=INDEX_NONE;
    }
    if (!PendingRefiles.IsEmpty())
    {
        if (ReturnStarted>=0 && Now-ReturnStarted>=RefileLength)
        {
            const auto Completed = PendingRefiles[0];
            UE_LOG(LogTemp,Display,TEXT("DOT_RECORD_REFILE deck=%d sleeve=%d track=%s"),
                Completed.Y,Completed.X+1,*SleeveTracks[Completed.X]);
            PendingRefiles.RemoveAt(0);
            ReturnStarted = -100;
        }
        if (!PendingRefiles.IsEmpty() && ReturnStarted<0) ReturnStarted = Now;
    }
    const double Refile = Now - ReturnStarted;
    const bool bSelecting = bShowCrates && PickSlot!=INDEX_NONE && Pull<LocalPickLength;
    const bool bRefiling = bShowCrates && !PendingRefiles.IsEmpty();
    FVector Target = PerformerHome;
    float ExpressiveTurn = 0;
    if (SelectionDisc) SelectionDisc->SetActorHiddenInGame(!bSelecting || Pull<.32);
    if (bSelecting && SelectionDisc)
    {
        const float CrateX = CrateCenter(PickSlot);
        const float Lift = FMath::SmoothStep(.32f,1.52f,float(Pull));
        SelectionDisc->SetActorLocation(FMath::Lerp(SleeveRecordCenter(PickSlot),LocalRecordLift(PickSlot),Lift));
        SelectionDisc->SetActorRotation(FRotator(0,0,-89));
        Target.X = CrateX*.55f;
        Target.Y -= 14.f;
        Target.Z += 6.f;
        ExpressiveTurn = CrateX<0 ? -14.f : 14.f;
    }
    if (ReturnDisc && !bRefiling) ReturnDisc->SetActorHiddenInGame(true);
    if (bRefiling && ReturnDisc)
    {
        const int32 Slot = PendingRefiles[0].X;
        const float CrateX = CrateCenter(Slot);
        const float File = FMath::SmoothStep(.19f,1.78f,float(Refile));
        const bool bSameCrate = bSelecting && Slot/4==PickSlot/4;
        ReturnDisc->SetActorHiddenInGame(bSameCrate || File>=1);
        if (!bSameCrate)
        {
            ReturnDisc->SetActorLocation(FMath::Lerp(LocalRecordLift(Slot),SleeveRecordCenter(Slot),File));
            ReturnDisc->SetActorRotation(FRotator(0,0,-89));
        }
        if (!bSelecting)
        {
            Target.X = CrateX*.55f;
            Target.Y -= 14.f;
            Target.Z += 6.f;
            ExpressiveTurn = CrateX<0 ? -14.f : 14.f;
        }
    }
    Performer->SetCrateEngaged(bSelecting||bRefiling);
    const FVector BaseLocation = Performer->GetActorLocation()-FVector(0,BoothClearanceDepth,0);
    Performer->SetActorLocation(FMath::VInterpTo(BaseLocation,Target,DeltaSeconds,3.6f));
    const FQuat Rotation = FRotator(0,ExpressiveTurn,0).Quaternion();
    Performer->SetActorRotation(FQuat::Slerp(Performer->GetActorQuat(),Rotation,FMath::Min(1.f,DeltaSeconds*9.f)));
    for (int32 Index=0; Index<CrateSleeves.Num(); ++Index)
    {
        const int32 Crate = Index/4;
        const int32 Slot = Index%4;
        const float PickTime = bSelecting && Crate==PickSlot/4 ? float(Pull)-Slot*.17f : -1.f;
        const float Tip = (FMath::SmoothStep(0.f,.48f,PickTime)-FMath::SmoothStep(.7f,1.68f,PickTime))*20.f;
        CrateSleeves[Index]->SetActorRotation(FRotator(0,0,6.f-1.35f*Slot+Tip));
        if (EmptySleeve)
        {
            const bool bInMotion = Index==PickSlot && Pull<.32;
            const bool bSeated = bRefiling && PendingRefiles[0].X==Index && Refile>=1.78;
            auto* Mesh = CrateSleeves[Index]->GetStaticMeshComponent();
            auto* Wanted = IsSleeveEmpty(Index) && !bInMotion && !bSeated ? EmptySleeve.Get() : FullSleeve.Get();
            if (Mesh->GetStaticMesh()!=Wanted) Mesh->SetStaticMesh(Wanted);
        }
    }

}

void ADotShowMode::MaintainBoothClearance(float DeltaSeconds)
{
    if (!bBoothVisible || !Performer) return;

    TArray<FBox, TInlineAllocator<2>> PoseBounds;
    Performer->ForEachComponent<UStaticMeshComponent>(false, [&PoseBounds](const UStaticMeshComponent* Part)
    {
        if (Part->IsVisible() && Part->GetStaticMesh()) PoseBounds.Add(Part->Bounds.GetBox());
    });

    TArray<FBox, TInlineAllocator<24>> Obstacles;
    const auto Collect = [&Obstacles](const auto& Parts)
    {
        for (const auto& Part : Parts)
            if (IsValid(Part) && !Part->IsHidden())
                Obstacles.Add(Part->GetStaticMeshComponent()->Bounds.GetBox());
    };
    Collect(BoothFurniture);
    Collect(PyramidFurniture);
    Collect(BoothParts);

    constexpr double Clearance = 8.0;
    const auto AxisGap = [](const FBox& A, const FBox& B, int32 Axis)
    {
        return FMath::Max(A.Min[Axis]-B.Max[Axis], B.Min[Axis]-A.Max[Axis]);
    };
    // Keep the posed character behind nearby props. Use depth only so the
    // camera angle and the height of unrelated records never push Dot up.
    double Required = 0.0, Anticipated = 0.0;
    for (const FBox& Pose : PoseBounds)
    {
        for (const FBox& Obstacle : Obstacles)
        {
            const double Gap=FMath::Max(AxisGap(Pose,Obstacle,0),AxisGap(Pose,Obstacle,2));
            const double Depth=FMath::Max(0.0,Obstacle.Max.Y+Clearance-Pose.Min.Y);
            if (Gap<Clearance) Required=FMath::Max(Required,Depth);
            Anticipated=FMath::Max(Anticipated,Depth*(1.0-FMath::SmoothStep(Clearance,Clearance+32.0,Gap)));
        }
    }
    const double Rearward=FMath::Max(Required,FMath::Lerp(BoothClearanceDepth,Anticipated,
        1.0-FMath::Exp(-DeltaSeconds*6.0)));

    BoothClearanceDepth = Rearward;
    const FVector Correction(0,Rearward,0);
    Performer->AddActorWorldOffset(Correction);
    if (!bAuditClearance || PoseBounds.IsEmpty() || Obstacles.IsEmpty()) return;

    for (const FBox& Pose : PoseBounds)
    {
        const FBox Final = Pose.ShiftBy(Correction);
        MinPerformerBottom = FMath::Min(MinPerformerBottom,Final.Min.Z);
        for (const FBox& Obstacle : Obstacles)
        {
            const double Gap = FMath::Max3(AxisGap(Final,Obstacle,0),
                AxisGap(Final,Obstacle,1),AxisGap(Final,Obstacle,2));
            MinBoothGap = FMath::Min(MinBoothGap,Gap);
        }
    }
    MaxBoothCorrection = FMath::Max(MaxBoothCorrection,Rearward);
    ClearanceAuditAge += DeltaSeconds;
    if (ClearanceAuditAge>=2)
    {
        UE_LOG(LogTemp,Display,TEXT("DOT_CLEARANCE gap=%.2f bottom=%.2f rearward=%.2f"),
            MinBoothGap,MinPerformerBottom,MaxBoothCorrection);
        MinBoothGap = MinPerformerBottom = TNumericLimits<double>::Max();
        MaxBoothCorrection = 0;
        ClearanceAuditAge = 0;
    }
}

void ADotShowMode::EndPlay(const EEndPlayReason::Type Reason)
{
    if (AudioSocket)
    {
        ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->DestroySocket(AudioSocket);
        AudioSocket = nullptr;
    }
    Super::EndPlay(Reason);
}

void ADotShowMode::TickMasterAudio()
{
    if (!AudioSocket) return;
    constexpr int Header = 16, MaxFrames = 240, FrameBytes = 4;
    const double Now = GetWorld()->GetTimeSeconds();
    uint8 Packet[Header + MaxFrames * FrameBytes + 1];
    for (int Batch = 0; Batch < 112; ++Batch)
    {
        int32 Bytes = 0;
        if (!AudioSocket->Recv(Packet, sizeof(Packet), Bytes)) break;
        if (Bytes < Header || FMemory::Memcmp(Packet, "CWPC", 4) != 0) continue;
        uint32 Rate, Sequence;
        uint16 Generation, Frames;
        FMemory::Memcpy(&Rate, Packet + 4, 4);
        FMemory::Memcpy(&Sequence, Packet + 8, 4);
        FMemory::Memcpy(&Generation, Packet + 12, 2);
        FMemory::Memcpy(&Frames, Packet + 14, 2);
        if (Rate < 32000 || Rate > 96000 || Frames < 1 || Frames > MaxFrames ||
            Bytes != Header + Frames * FrameBytes) continue;
        if (!MasterWave || AudioRate != Rate || AudioGeneration != Generation)
        {
            MasterAudio->Stop();
            MasterWave = NewObject<USoundWaveProcedural>(this);
            MasterWave->SetSampleRate(Rate);
            MasterWave->NumChannels = 2;
            MasterWave->Duration = INDEFINITELY_LOOPING_DURATION;
            MasterWave->VirtualizationMode = EVirtualizationMode::PlayWhenSilent;
            MasterAudio->SetSound(MasterWave);
            AudioRate = Rate;
            AudioGeneration = Generation;
            AudioSequence = Sequence - 1;
            bAudioSignal = false;
            UE_LOG(LogTemp, Display, TEXT("DOT_MASTER_PCM rate=%d channels=2"), Rate);
        }
        if (int32(Sequence - AudioSequence) <= 0) continue;
        AudioSequence = Sequence;
        LastAudioPacketAt = Now;
        if (MasterWave->GetAvailableAudioByteCount() > int32(Rate * FrameBytes / 5))
            MasterWave->ResetAudio();
        MasterWave->QueueAudio(Packet + Header, Bytes - Header);
        float Sum = 0;
        for (int Offset = Header; Offset + 3 < Bytes; Offset += 4)
        {
            int16 L, R;
            FMemory::Memcpy(&L, Packet + Offset, 2);
            FMemory::Memcpy(&R, Packet + Offset + 2, 2);
            const float Stereo = (float(L) + float(R)) / 65536.f;
            const float Alpha = FMath::Min(1.f, 2.f * UE_PI * 145.f / Rate);
            BassFollower += Alpha * (Stereo - BassFollower);
            Sum += BassFollower * BassFollower;
        }
        MasterLevel = FMath::Lerp(MasterLevel, FMath::Clamp(6.f * FMath::Sqrt(Sum / Frames), 0.f, 1.f), .14f);
        if (!bAudioSignal)
        {
            for (int Offset = Header; Offset + 1 < Bytes; Offset += 2)
            {
                int16 Sample;
                FMemory::Memcpy(&Sample, Packet + Offset, 2);
                if (FMath::Abs(int32(Sample)) < 128) continue;
                bAudioSignal = true;
                UE_LOG(LogTemp, Display, TEXT("DOT_MASTER_SIGNAL"));
                break;
            }
        }
    }
    if (MasterWave && Now - LastAudioPacketAt > .65)
    {
        MasterAudio->Stop();
        MasterAudio->SetSound(nullptr);
        MasterWave = nullptr;
    }
    if (MasterWave && !MasterAudio->IsPlaying() &&
        MasterWave->GetAvailableAudioByteCount() >= int32(AudioRate * FrameBytes / 18))
        MasterAudio->Play();
}
