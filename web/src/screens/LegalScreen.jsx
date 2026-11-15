// LegalScreen.jsx — privacy notice and terms for the pilot. The wording describes
// what the code actually does; it needs a lawyer's review before public launch.
import AppHeader from "../components/AppHeader.jsx";
import { useI18n } from "../i18n.jsx";
import { CONSENT_VERSION } from "../strings.js";

const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || "";

const CONTENT = {
  en: {
    privacy: {
      title: "Privacy notice",
      sections: [
        ["What we collect from farmers", "No account or name is needed. When a location is checked, we store the tapped coordinates and the estimate given, so it can later be compared with real drilling results."],
        ["What we collect from rig operators", "Name, phone number, a protected password, and each drill record: GPS position and accuracy, date, depth, rock layers, water strike, yield, photos and videos. We also keep security records of sign-ins, using scrambled fingerprints of the IP address and browser rather than the originals."],
        ["Why we use it", "To give estimates, verify drilling records, publish the accuracy ledger, keep accounts secure, and improve the prediction model."],
        ["What the public can see", "Verified wells appear on the public map with depth, rock layers and yield. Their position is rounded to about 1 km. Names, village text, exact GPS, photos and videos are not public; they are visible only to the operator who submitted them and to BoreSakshi reviewers."],
        ["Who else receives it", "Hosting and database providers that run the service. The map is loaded from OpenStreetMap and fonts from Google Fonts, and those services can see your IP address. We do not sell personal data."],
        ["Your choices", "You can ask us to access, correct or delete your personal data, or withdraw consent. Verified drilling results may be kept without your name so the public ledger stays accurate."],
      ],
    },
    terms: {
      title: "Terms of use",
      sections: [
        ["An estimate, not a guarantee", "BoreSakshi provides estimates only. It does not promise that water will be found at any place, depth or yield. It may also show no estimate at all when it does not have enough information."],
        ["Your decision", "Decisions to drill are yours. Consult a qualified hydrogeologist and follow local rules on borewell drilling and groundwater use. BoreSakshi is not responsible for drilling costs or losses based on an estimate, to the extent the law allows."],
        ["Operator responsibilities", "Submit only genuine records of work you carried out, with photos you have the right to share. Records are reviewed, and accounts that submit false data can be deactivated."],
        ["Pilot service", "This is a pilot. Features may change or stop, and the service may sometimes be unavailable."],
      ],
    },
    contactLabel: "Contact",
    contactFallback: "Contact the BoreSakshi pilot team through your local coordinator.",
    version: "Version",
  },
  ta: {
    privacy: {
      title: "தனியுரிமை அறிவிப்பு",
      sections: [
        ["விவசாயிகளிடமிருந்து என்ன சேகரிக்கிறோம்", "கணக்கோ பெயரோ தேவையில்லை. ஓர் இடத்தைச் சரிபார்க்கும்போது, தொட்ட ஆயத்தொலைவுகளையும் வழங்கிய மதிப்பீட்டையும் சேமிக்கிறோம். பின்னர் உண்மையான துளையிடல் முடிவுகளுடன் ஒப்பிடுவதற்காக இது."],
        ["ரிக் இயக்குநர்களிடமிருந்து என்ன சேகரிக்கிறோம்", "பெயர், தொலைபேசி எண், பாதுகாக்கப்பட்ட கடவுச்சொல், மற்றும் ஒவ்வொரு துளையிடல் பதிவும்: GPS இடம், துல்லியம், நாள், ஆழம், பாறை அடுக்குகள், நீர் கிடைத்த ஆழம், நீர் அளவு, புகைப்படங்கள், காணொளிகள். உள்நுழைவுகளின் பாதுகாப்புப் பதிவுகளையும் வைத்திருக்கிறோம்; இதில் IP முகவரி, உலாவியின் உண்மையான விவரங்களுக்குப் பதிலாக மறைக்கப்பட்ட அடையாளங்கள் பயன்படுத்தப்படும்."],
        ["ஏன் பயன்படுத்துகிறோம்", "மதிப்பீடுகள் வழங்க, துளையிடல் பதிவுகளைச் சரிபார்க்க, துல்லியப் பதிவேட்டை வெளியிட, கணக்குகளைப் பாதுகாக்க, கணிப்பு மாதிரியை மேம்படுத்த."],
        ["பொதுமக்கள் என்ன காணலாம்", "சரிபார்க்கப்பட்ட கிணறுகள் ஆழம், பாறை அடுக்குகள், நீர் அளவுடன் பொது வரைபடத்தில் தோன்றும். அவற்றின் இடம் சுமார் 1 கி.மீக்கு முழுமையாக்கப்படும். பெயர்கள், கிராம விவரம், துல்லியமான GPS, புகைப்படங்கள், காணொளிகள் பொதுவில் இல்லை; சமர்ப்பித்த இயக்குநருக்கும் போர்சாக்ஷி ஆய்வாளர்களுக்கும் மட்டுமே தெரியும்."],
        ["வேறு யார் பெறுகிறார்கள்", "சேவையை இயக்கும் ஹோஸ்டிங், தரவுத்தள நிறுவனங்கள். வரைபடம் OpenStreetMap இலிருந்தும் எழுத்துருக்கள் Google Fonts இலிருந்தும் ஏற்றப்படுகின்றன; அவை உங்கள் IP முகவரியைக் காணலாம். தனிப்பட்ட தரவை நாங்கள் விற்பதில்லை."],
        ["உங்கள் தேர்வுகள்", "உங்கள் தனிப்பட்ட தரவைப் பார்க்க, திருத்த, நீக்க அல்லது ஒப்புதலைத் திரும்பப் பெற எங்களிடம் கேட்கலாம். பொதுப் பதிவேடு சரியாக இருக்க, சரிபார்க்கப்பட்ட துளையிடல் முடிவுகள் உங்கள் பெயர் இல்லாமல் வைத்திருக்கப்படலாம்."],
      ],
    },
    terms: {
      title: "பயன்பாட்டு விதிமுறைகள்",
      sections: [
        ["மதிப்பீடு மட்டுமே, உத்தரவாதம் அல்ல", "போர்சாக்ஷி மதிப்பீடுகளை மட்டுமே வழங்குகிறது. எந்த இடத்திலும், ஆழத்திலும், அளவிலும் நீர் கிடைக்கும் என்று உறுதியளிக்கவில்லை. போதிய தகவல் இல்லாதபோது மதிப்பீடே காட்டப்படாமல் போகலாம்."],
        ["உங்கள் முடிவு", "துளையிடும் முடிவு உங்களுடையது. தகுதியான நீரியல் நிபுணரை அணுகி, போர்வெல் துளையிடல், நிலத்தடி நீர்ப் பயன்பாடு தொடர்பான உள்ளூர் விதிகளைப் பின்பற்றுங்கள். மதிப்பீட்டின் அடிப்படையிலான துளையிடல் செலவுகள், இழப்புகளுக்கு, சட்டம் அனுமதிக்கும் அளவில், போர்சாக்ஷி பொறுப்பல்ல."],
        ["இயக்குநரின் பொறுப்புகள்", "நீங்கள் செய்த பணியின் உண்மையான பதிவுகளை மட்டும், பகிர உரிமையுள்ள புகைப்படங்களுடன் சமர்ப்பியுங்கள். பதிவுகள் ஆய்வு செய்யப்படும்; தவறான தரவு சமர்ப்பிக்கும் கணக்குகள் முடக்கப்படலாம்."],
        ["முன்னோட்டச் சேவை", "இது ஒரு முன்னோட்டத் திட்டம். அம்சங்கள் மாறலாம் அல்லது நிறுத்தப்படலாம்; சேவை சில நேரங்களில் கிடைக்காமல் போகலாம்."],
      ],
    },
    contactLabel: "தொடர்புக்கு",
    contactFallback: "உங்கள் உள்ளூர் ஒருங்கிணைப்பாளர் மூலம் போர்சாக்ஷி குழுவைத் தொடர்பு கொள்ளுங்கள்.",
    version: "பதிப்பு",
  },
};

export default function LegalScreen({ page }) {
  const { lang } = useI18n();
  const copy = CONTENT[lang];
  const { title, sections } = copy[page];
  return (
    <div className="op">
      <AppHeader subtitle={title} />
      <main className="legal-body op-anim">
        <h1>{title}</h1>
        {sections.map(([heading, body]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            <p>{body}</p>
          </section>
        ))}
        <section>
          <h2>{copy.contactLabel}</h2>
          <p>{CONTACT ? <a href={`mailto:${CONTACT}`}>{CONTACT}</a> : copy.contactFallback}</p>
        </section>
        <p className="legal-version">{copy.version}: {CONSENT_VERSION}</p>
      </main>
    </div>
  );
}
